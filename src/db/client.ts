import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __growthDb?: { db: DB; client: postgres.Sql } };

function create() {
  const url = env().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  // prepare:false keeps us compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: 10, idle_timeout: 20, onnotice: () => {} });
  return { client, db: drizzle(client, { schema }) };
}

function instance() {
  if (!globalForDb.__growthDb) globalForDb.__growthDb = create();
  return globalForDb.__growthDb;
}

/**
 * Run queries as the given user. Inside the transaction the role is switched to
 * `authenticated` and the JWT `sub` claim is set, so Postgres Row Level Security
 * enforces ownership on every statement — the same policies Supabase applies.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return instance().db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/**
 * Privileged access that bypasses RLS. Only for server-side integration code that must
 * touch server-only tables (encrypted credentials, OAuth state) or cron jobs. Always
 * filter by user id explicitly when using this.
 */
export async function asService<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  return fn(instance().db);
}
