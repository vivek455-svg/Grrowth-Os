import { describe, expect, it } from "vitest";
import { cleanDatabaseUrl, findConfigProblems, resolveAppUrl } from "@/lib/env";

const DB = "postgresql://postgres.abc:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" };
const keys = (raw: Parameters<typeof findConfigProblems>[0]) => findConfigProblems(raw).map((p) => p.key);
const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;

describe("findConfigProblems", () => {
  it("accepts a complete production config", () => {
    expect(findConfigProblems({ DATABASE_URL: DB, ...SUPABASE })).toEqual([]);
  });

  it("accepts the local demo config", () => {
    expect(findConfigProblems({ DATABASE_URL: "postgres://growth:growth@localhost:5432/growth_os", DEMO_MODE: "true" })).toEqual([]);
  });

  it("reports a missing or placeholder database URL", () => {
    expect(keys({ ...SUPABASE })).toEqual(["DATABASE_URL"]);
    expect(findConfigProblems({ ...SUPABASE, DATABASE_URL: DB.replace("secret", "[YOUR-PASSWORD]") })[0]?.message).toMatch(/YOUR-PASSWORD/);
    expect(keys({ ...SUPABASE, DATABASE_URL: "db.abc.supabase.co" })).toEqual(["DATABASE_URL"]);
  });

  it("requires sign-in to be configured unless demo mode is on", () => {
    expect(keys({ DATABASE_URL: DB })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(keys({ DATABASE_URL: DB, NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL })).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  });

  it("rejects dashboard or API URLs in place of the project URL", () => {
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, NEXT_PUBLIC_SUPABASE_URL: "https://supabase.com/dashboard/project/abc" })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/rest/v1/" })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("refuses a secret key in the public anon key slot", () => {
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") })).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" })).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon") })).toEqual([]);
  });

  it("reports an unusable APP_URL", () => {
    expect(keys({ DATABASE_URL: DB, ...SUPABASE, APP_URL: "my app" })).toEqual(["APP_URL"]);
  });
});

describe("Vercel Supabase integration variables", () => {
  const POSTGRES_URL = `${DB}?sslmode=require&supa=base-pooler.x`;

  it("uses POSTGRES_URL when DATABASE_URL is unset or still has the placeholder", () => {
    expect(findConfigProblems({ ...SUPABASE, POSTGRES_URL })).toEqual([]);
    expect(findConfigProblems({ ...SUPABASE, POSTGRES_URL, DATABASE_URL: DB.replace("secret", "[YOUR-PASSWORD]") })).toEqual([]);
  });

  it("prefers a real DATABASE_URL over POSTGRES_URL", () => {
    expect(keys({ ...SUPABASE, POSTGRES_URL, DATABASE_URL: "not a url" })).toEqual(["DATABASE_URL"]);
  });

  it("accepts the publishable key and SUPABASE_URL names", () => {
    expect(findConfigProblems({ DATABASE_URL: DB, SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toEqual([]);
  });

  it("drops connection parameters postgres.js would send to the server as settings", () => {
    expect(cleanDatabaseUrl(POSTGRES_URL)).toBe(`${DB}?sslmode=require`);
    expect(cleanDatabaseUrl(`${DB}?workaround=supabase-pooler.vercel&pgbouncer=true`)).toBe(DB);
    expect(cleanDatabaseUrl(DB)).toBe(DB);
  });
});

describe("resolveAppUrl", () => {
  it("normalises scheme and trailing slashes", () => {
    expect(resolveAppUrl({ APP_URL: "grrowth-os.vercel.app" })).toBe("https://grrowth-os.vercel.app");
    expect(resolveAppUrl({ APP_URL: "https://grrowth-os.vercel.app/" })).toBe("https://grrowth-os.vercel.app");
    expect(resolveAppUrl({ APP_URL: "localhost:3000" })).toBe("http://localhost:3000");
  });

  it("falls back to the Vercel production domain, then localhost", () => {
    expect(resolveAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "grrowth-os.vercel.app", VERCEL_URL: "grrowth-os-abc.vercel.app" })).toBe("https://grrowth-os.vercel.app");
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });
});
