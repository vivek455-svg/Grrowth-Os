/**
 * LOCAL ONLY: drops and recreates the local dev database, applies migrations, seeds the demo workspace.
 *
 *   npm run db:reset-local        # reads DATABASE_URL from .env.local
 *
 * Works on macOS, Linux and Windows (no psql or bash needed). Refuses to touch a non-local
 * host or to run while Supabase auth is configured.
 */
import postgres from "postgres";
import { loadLocalEnv } from "./env";
import { migrate } from "./migrate";
import { seedDemo } from "./seed-demo";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

async function main() {
  loadLocalEnv();
  const url = new URL(process.env.DATABASE_URL ?? "postgres://growth:growth@localhost:5432/growth_os");
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Refusing to reset: Supabase is configured in your env.");
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`Refusing to reset non-local database host "${url.hostname}".`);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[\w-]+$/.test(dbName)) throw new Error(`Unexpected database name "${dbName}".`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists "${dbName}" with (force)`);
    await sql.unsafe(`create database "${dbName}"`);
    console.log(`recreated database ${dbName}`);
  } finally {
    await sql.end();
  }
  await migrate(url.toString());
  await seedDemo(url.toString());
  console.log("demo workspace ready → npm run dev, then open http://localhost:3000");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
