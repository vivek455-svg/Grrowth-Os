/**
 * Database integration tests against a real Postgres (TEST_DATABASE_URL).
 * They apply the migrations to a fresh database, seed the demo workspace, and verify
 * Row Level Security, server-only tables, constraints, and that the Drizzle schema matches.
 *
 * Skipped when TEST_DATABASE_URL is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { migrate } from "../scripts/migrate";
import { seedDemo } from "../scripts/seed-demo";

const url = process.env.TEST_DATABASE_URL;
const DEMO = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

const d = url ? describe : describe.skip;

d("database: migrations, RLS and constraints", () => {
  let sql: postgres.Sql;

  /** Runs fn as an authenticated user, mirroring withUser() in src/db/client.ts. Always rolls back. */
  async function as<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let out: T;
    await sql
      .begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        out = await fn(tx);
        throw new Error("__rollback__");
      })
      .catch((e) => {
        if (e.message !== "__rollback__") throw e;
      });
    return out!;
  }

  beforeAll(async () => {
    const admin = postgres(url!.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
    const name = url!.split("/").pop()!;
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
    await admin.end();
    await migrate(url!, { log: () => {} });
    await seedDemo(url!);
    sql = postgres(url!, { max: 2, onnotice: () => {} });
    await sql`insert into auth.users (id, email) values (${OTHER}, 'other@test.local')`;
  }, 60000);

  afterAll(async () => {
    await sql?.end();
  });

  it("drizzle schema columns all exist in the migrated database", async () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v);
    expect(tables.length).toBeGreaterThan(25);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const cols = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${cfg.name}`;
      const actual = new Set(cols.map((c) => c.column_name));
      for (const c of cfg.columns) expect(actual.has(c.name), `${cfg.name}.${c.name}`).toBe(true);
    }
  });

  it("every user-owned table has RLS enabled", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_migrations'`;
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("another user sees none of the demo workspace's rows", async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'
      and table_name not in ('integration_credentials', 'oauth_states')`;
    const counts = await as(OTHER, async (tx) => {
      const out: Record<string, number> = {};
      for (const { table_name } of tables) out[table_name] = Number((await tx.unsafe(`select count(*)::int as n from public."${table_name}" where user_id <> '${OTHER}'`))[0]!.n);
      return out;
    });
    for (const [t, n] of Object.entries(counts)) expect(n, t).toBe(0);
    // Sanity: the demo user does see its own data.
    const own = await as(DEMO, (tx) => tx`select count(*)::int as n from prospects`);
    expect(own[0]!.n).toBeGreaterThan(10);
  });

  it("users cannot modify or delete other users' rows, or insert rows as someone else", async () => {
    const res = await as(OTHER, async (tx) => {
      const upd = await tx`update prospects set full_name = 'hijacked' returning id`;
      const del = await tx`delete from content_items returning id`;
      return { upd: upd.length, del: del.length };
    });
    expect(res).toEqual({ upd: 0, del: 0 });
    await expect(as(OTHER, (tx) => tx`insert into prospects (user_id, full_name) values (${DEMO}, 'spoof')`)).rejects.toThrow(/row-level security/);
  });

  it("server-only tables are not readable by signed-in users", async () => {
    await expect(as(DEMO, (tx) => tx`select * from integration_credentials`)).rejects.toThrow(/permission denied/);
    await expect(as(DEMO, (tx) => tx`select * from oauth_states`)).rejects.toThrow(/permission denied/);
  });

  it("the audit log is append-only for users", async () => {
    await expect(as(DEMO, (tx) => tx`update activity_logs set action = 'tampered'`)).rejects.toThrow(/permission denied/);
    await expect(as(DEMO, (tx) => tx`delete from activity_logs`)).rejects.toThrow(/permission denied/);
    const ok = await as(DEMO, (tx) => tx`insert into activity_logs (action) values ('test') returning id`);
    expect(ok).toHaveLength(1);
  });

  it("constraints prevent invalid states", async () => {
    // A post can't be "published" without a publication time and source.
    await expect(
      as(DEMO, async (tx) => {
        const [i] = await tx`insert into content_items (title) values ('t') returning id`;
        await tx`insert into content_platform_versions (content_item_id, platform, status) values (${i!.id}, 'x', 'published')`;
      }),
    ).rejects.toThrow(/check constraint/);
    // A message can't be "sent" without a send time, method and approval.
    await expect(
      as(DEMO, async (tx) => {
        const [p] = await tx`select id from prospects limit 1`;
        await tx`insert into outreach_messages (prospect_id, channel, body, status) values (${p!.id}, 'email', 'hi', 'sent')`;
      }),
    ).rejects.toThrow(/check constraint/);
    // Lead status must be one of the user's statuses.
    await expect(as(DEMO, (tx) => tx`insert into prospects (full_name, status) values ('x', 'made_up_status')`)).rejects.toThrow(/foreign key/);
    // Metrics can't be negative.
    await expect(
      as(DEMO, async (tx) => {
        const [v] = await tx`select id from content_platform_versions where status = 'published' limit 1`;
        await tx`insert into content_metrics_snapshots (version_id, impressions, source) values (${v!.id}, -5, 'manual')`;
      }),
    ).rejects.toThrow(/check constraint/);
  });

  it("duplicate prospects by email or LinkedIn profile are rejected per user, not across users", async () => {
    const [existing] = await as(DEMO, (tx) => tx`select email from prospects where email is not null limit 1`);
    await expect(as(DEMO, (tx) => tx`insert into prospects (full_name, email) values ('Dup', ${existing!.email.toUpperCase()})`)).rejects.toThrow(/duplicate key/);
    // A different user may hold the same contact independently.
    const other = await as(OTHER, async (tx) => {
      await tx`select seed_workspace_defaults(${OTHER})`.catch(() => null);
      return tx`insert into prospects (full_name, email) values ('Dup', ${existing!.email}) returning id`;
    });
    expect(other).toHaveLength(1);
  });

  it("new auth users get default lead statuses and pipeline stages", async () => {
    const r = await as(OTHER, async (tx) => ({
      statuses: (await tx`select count(*)::int as n from lead_statuses`)[0]!.n,
      stages: (await tx`select count(*)::int as n from pipeline_stages`)[0]!.n,
    }));
    expect(r.statuses).toBe(13);
    expect(r.stages).toBe(8);
  });

  it("demo seed uses reserved .example domains only", async () => {
    const rows = await as(DEMO, (tx) => tx`select company_website, email from prospects`);
    for (const r of rows) {
      expect(r.company_website).toMatch(/\.example$/);
      if (r.email) expect(r.email).toMatch(/\.example$/);
    }
  });
});
