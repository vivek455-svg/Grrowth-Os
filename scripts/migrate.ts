/**
 * Applies SQL migrations in supabase/migrations to DATABASE_URL.
 *
 *   npm run db:migrate            # local Postgres (also applies supabase/local-shim.sql)
 *
 * For a Supabase project prefer `supabase db push`. If you run this script against
 * Supabase, set MIGRATE_SKIP_SHIM=1 so the local auth shim is never applied.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadLocalEnv } from "./env";

export async function migrate(databaseUrl: string, { shim = true, log = console.log } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    if (shim) await sql.unsafe(readFileSync(join(process.cwd(), "supabase/local-shim.sql"), "utf8"));
    await sql`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql<{ name: string }[]>`select name from public._migrations`).map((r) => r.name));
    const dir = join(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, file), "utf8"));
        await tx`insert into public._migrations (name) values (${file})`;
      });
      log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  migrate(url, { shim: process.env.MIGRATE_SKIP_SHIM !== "1" }).then(
    () => console.log("migrations up to date"),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
