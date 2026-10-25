import "server-only";
import postgres from "postgres";
import { configProblems, env, type ConfigProblem } from "@/lib/env";

export type SetupStatus = { ok: boolean; problems: ConfigProblem[]; appUrl: string };

const TIMEOUT_MS = 5000;
const OK_CACHE_MS = 60_000;
let lastOk = 0;

function describeDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (/tenant or user not found/i.test(msg)) return "The Supabase pooler doesn't recognise the user. Copy the pooler string exactly (user is postgres.<project-ref>).";
  if (code === "28P01" || /password authentication failed/i.test(msg)) return "Password authentication failed. Check the password in the connection string.";
  if (code === "3D000") return "That database doesn't exist. Check the database name at the end of the connection string.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Database host not found. Check the host in the connection string.";
  if (/ssl|tls/i.test(msg)) return "The database requires SSL. Add ?sslmode=require to the end of the connection string.";
  if (["ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "CONNECT_TIMEOUT", "ECONNREFUSED"].includes(code)) {
    return "Couldn't reach the database. On Vercel use Supabase's pooler connection string (Transaction mode, port 6543): the direct connection is IPv6-only.";
  }
  return `Couldn't connect to the database (${code || "unknown error"}).`;
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "CONNECT_TIMEOUT" })), TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Connects with a short-lived client and checks that the migrations and Supabase roles exist. */
async function checkDatabase(url: string): Promise<string | null> {
  let sql: postgres.Sql | null = null;
  try {
    sql = postgres(url, { max: 1, prepare: false, connect_timeout: TIMEOUT_MS / 1000, idle_timeout: 1, onnotice: () => {} });
    const db = sql;
    const [row] = await withTimeout(
      db<{ ready: boolean }[]>`select to_regclass('public.profiles') is not null and to_regclass('public.content_items') is not null as ready`
    );
    if (!row?.ready) return "Connected, but the app's tables don't exist yet. Apply supabase/migrations to this database (README → Production setup).";
    await withTimeout(
      db.begin(async (tx) => {
        await tx`set local role authenticated`;
      })
    );
    return null;
  } catch (err) {
    if (/role "authenticated" does not exist/i.test((err as Error)?.message ?? "")) {
      return "Connected, but this isn't a Supabase database (the authenticated role is missing). Point DATABASE_URL at your Supabase project.";
    }
    return describeDbError(err);
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => {});
  }
}

/** Checks the Supabase URL is reachable and the anon key is accepted. */
async function checkSupabase(url: string, key: string): Promise<ConfigProblem | null> {
  try {
    const res = await fetch(new URL("/auth/v1/settings", url), { headers: { apikey: key }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) {
      return { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", message: "Supabase rejected this key. Copy the anon / publishable key from Project Settings → API." };
    }
    return { key: "NEXT_PUBLIC_SUPABASE_URL", message: `Supabase answered with HTTP ${res.status}. Check that this is your project URL.` };
  } catch {
    return { key: "NEXT_PUBLIC_SUPABASE_URL", message: "Couldn't reach Supabase at this URL. Check the project URL and that the project isn't paused." };
  }
}

/**
 * Everything the deployment needs before anyone can sign in: valid settings, a reachable
 * Supabase project, and a database with the migrations applied. Reports variable names only.
 */
export async function setupStatus(): Promise<SetupStatus> {
  const e = env();
  if (Date.now() - lastOk < OK_CACHE_MS) return { ok: true, problems: [], appUrl: e.APP_URL };
  const problems = configProblems();
  const has = (key: string) => problems.some((p) => p.key === key);
  const [dbProblem, supabaseProblem] = await Promise.all([
    has("DATABASE_URL") ? null : checkDatabase(e.DATABASE_URL!),
    has("NEXT_PUBLIC_SUPABASE_URL") || has("NEXT_PUBLIC_SUPABASE_ANON_KEY") || !e.NEXT_PUBLIC_SUPABASE_URL
      ? null
      : checkSupabase(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!),
  ]);
  if (dbProblem) problems.push({ key: "DATABASE_URL", message: dbProblem });
  if (supabaseProblem) problems.push(supabaseProblem);
  if (problems.length === 0) lastOk = Date.now();
  return { ok: problems.length === 0, problems, appUrl: e.APP_URL };
}
