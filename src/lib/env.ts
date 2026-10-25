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
  // Set by the Vercel ↔ Supabase integration; used when DATABASE_URL isn't set.
  POSTGRES_URL: optional,
  APP_URL: optional,
  VERCEL_PROJECT_PRODUCTION_URL: optional,
  VERCEL_URL: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
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
export type Env = Omit<Raw, "APP_URL"> & {
  APP_URL: string;
  /** Which variable DATABASE_URL was read from, for setup messages. */
  DATABASE_URL_KEY: "DATABASE_URL" | "POSTGRES_URL";
};

// Connection-string parameters postgres.js understands. It forwards any other parameter to the
// server as a session setting, so extras added by hosting integrations (supa=…, workaround=…,
// pgbouncer=…) would make the connection fail.
const KEEP_DB_PARAMS = new Set(["sslmode", "sslrootcert", "application_name", "options", "connect_timeout"]);

export function cleanDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const extra = [...url.searchParams.keys()].filter((k) => !KEEP_DB_PARAMS.has(k));
    if (extra.length === 0) return value;
    for (const k of extra) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return value;
  }
}

const hasPasswordPlaceholder = (value?: string) => Boolean(value && /\[YOUR-PASSWORD\]/i.test(value));

/**
 * Applies fallbacks: the integration's POSTGRES_URL when DATABASE_URL is unset or still holds
 * Supabase's [YOUR-PASSWORD] placeholder, the integration's Supabase key names, and the Vercel
 * domain for APP_URL.
 */
function resolve(raw: Partial<Raw>): Env {
  const useIntegration = Boolean(raw.POSTGRES_URL) && (!raw.DATABASE_URL || hasPasswordPlaceholder(raw.DATABASE_URL));
  const db = useIntegration ? raw.POSTGRES_URL : raw.DATABASE_URL;
  return {
    ...(raw as Raw),
    DATABASE_URL: db ? cleanDatabaseUrl(db) : undefined,
    DATABASE_URL_KEY: useIntegration ? "POSTGRES_URL" : "DATABASE_URL",
    NEXT_PUBLIC_SUPABASE_URL: raw.NEXT_PUBLIC_SUPABASE_URL ?? raw.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    APP_URL: resolveAppUrl(raw) ?? "http://localhost:3000",
  };
}

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
  cached = resolve(schema.parse(process.env));
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
export function findConfigProblems(input: Partial<Raw>): ConfigProblem[] {
  const raw = resolve(input);
  const problems: ConfigProblem[] = [];
  const db = raw.DATABASE_URL;
  const dbKey = raw.DATABASE_URL_KEY;
  if (!db) {
    problems.push({
      key: "DATABASE_URL",
      message: "Not set. Connect the Supabase integration in Vercel (it adds POSTGRES_URL), or paste Supabase's Transaction pooler connection string (port 6543).",
    });
  } else if (hasPasswordPlaceholder(db)) {
    problems.push({ key: dbKey, message: "Still contains [YOUR-PASSWORD]. Replace it with your database password." });
  } else if (!isUrl(db, ["postgres:", "postgresql:"])) {
    problems.push({
      key: dbKey,
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

  if (!resolveAppUrl(input)) {
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
