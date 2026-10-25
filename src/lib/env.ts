import "server-only";
import { z } from "zod";

/** Trims values and strips one pair of wrapping quotes (a common copy-paste slip in hosting dashboards). */
const optional = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    return t ? t : undefined;
  });

// Parsing never fails on a missing or malformed value: configProblems() reports those so the
// app can show a setup checklist instead of crashing every page.
const schema = z.object({
  DATABASE_URL: optional,
  APP_URL: optional,
  VERCEL_PROJECT_PRODUCTION_URL: optional,
  VERCEL_URL: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  DEMO_MODE: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  CRON_SECRET: optional,
  AI_PROVIDER: z.enum(["anthropic", "openai"]).optional().catch(undefined),
  AI_MODEL: optional,
  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,
  OPENAI_BASE_URL: optional,
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  SEARCH_PROVIDER: z.enum(["brave", "exa"]).optional().catch(undefined),
  SEARCH_API_KEY: optional,
});

type Raw = z.infer<typeof schema>;
export type Env = Omit<Raw, "APP_URL"> & { APP_URL: string };

/** APP_URL, else the Vercel production domain, else localhost. Adds https:// when the scheme is missing. */
export function resolveAppUrl(raw: Partial<Pick<Raw, "APP_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | "VERCEL_URL">>): string | null {
  const value = raw.APP_URL ?? raw.VERCEL_PROJECT_PRODUCTION_URL ?? raw.VERCEL_URL;
  if (!value) return "http://localhost:3000";
  try {
    const scheme = /^https?:\/\//i.test(value) ? "" : /^(localhost|127\.0\.0\.1)(:|\/|$)/.test(value) ? "http://" : "https://";
    const url = new URL(scheme + value);
    return url.hostname.includes(".") || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  cached = { ...parsed, APP_URL: resolveAppUrl(parsed) ?? "http://localhost:3000" };
  return cached;
}

export type ConfigProblem = { key: string; message: string };

function isUrl(value: string, protocols: string[]) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** The JWT `role` claim of a legacy Supabase key, if it is one. */
function supabaseKeyRole(key: string) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"))?.role as string | undefined;
  } catch {
    return undefined;
  }
}

/** Every missing or malformed setting, by variable name. Never includes values. */
export function findConfigProblems(raw: Partial<Raw>): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const db = raw.DATABASE_URL;
  if (!db) {
    problems.push({ key: "DATABASE_URL", message: "Not set. On Supabase, copy the pooler connection string (Connect → Transaction pooler, port 6543)." });
  } else if (/\[YOUR-PASSWORD\]/i.test(db)) {
    problems.push({ key: "DATABASE_URL", message: "Still contains [YOUR-PASSWORD]. Replace it with your database password." });
  } else if (!isUrl(db, ["postgres:", "postgresql:"])) {
    problems.push({
      key: "DATABASE_URL",
      message: "Isn't a valid postgres:// connection string. If the password contains characters like @ # / ? %, URL-encode them.",
    });
  }

  const url = raw.NEXT_PUBLIC_SUPABASE_URL;
  const key = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url && !key) {
    if (raw.DEMO_MODE !== "true") {
      problems.push({ key: "NEXT_PUBLIC_SUPABASE_URL", message: "Sign-in isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." });
    }
  } else if (!url) {
    problems.push({ key: "NEXT_PUBLIC_SUPABASE_URL", message: "Not set, but the anon key is. Set both Supabase variables." });
  } else if (!key) {
    problems.push({ key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", message: "Not set, but the Supabase URL is. Set both Supabase variables." });
  } else {
    if (!isUrl(url, ["https:", "http:"]) || /\/(rest|auth)\/v1/.test(url) || url.includes("supabase.com/dashboard")) {
      problems.push({ key: "NEXT_PUBLIC_SUPABASE_URL", message: "Must be the project URL, like https://<project-ref>.supabase.co (Project Settings → API)." });
    }
    if (key.startsWith("sb_secret_") || supabaseKeyRole(key) === "service_role") {
      problems.push({
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        message: "This is the secret service-role key. It would be exposed in the browser: use the anon / publishable key instead, and rotate the secret key.",
      });
    }
  }

  if (!resolveAppUrl(raw)) {
    problems.push({ key: "APP_URL", message: "Must be the site's full address, like https://your-app.vercel.app (or leave it unset on Vercel)." });
  }
  return problems;
}

export function configProblems(): ConfigProblem[] {
  return findConfigProblems(schema.parse(process.env));
}

export function supabaseConfigured() {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Demo mode is only honoured when Supabase auth is NOT configured. */
export function demoMode() {
  return !supabaseConfigured() && env().DEMO_MODE === "true";
}
