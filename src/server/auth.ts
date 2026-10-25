import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { asService } from "@/db/client";
import { demoMode, supabaseConfigured } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

export type SessionUser = { id: string; email: string | null; isDemo: boolean };

async function ensureDemoUser() {
  await asService(async (db) => {
    await db.execute(sql`insert into auth.users (id, email) values (${DEMO_USER_ID}, 'demo@growth-os.local') on conflict (id) do nothing`);
    await db.execute(sql`update public.profiles set is_demo = true where id = ${DEMO_USER_ID} and not is_demo`);
  });
}

/** Resolves the signed-in user once per request. Returns null when signed out. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Always render per request: user data must never be baked into a static page.
  await connection();
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    // getUser() validates the JWT with Supabase Auth rather than trusting the cookie.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, isDemo: false };
  }
  if (demoMode()) {
    await ensureDemoUser();
    return { id: DEMO_USER_ID, email: "demo@growth-os.local", isDemo: true };
  }
  return null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(supabaseConfigured() ? "/login" : "/setup");
  return user;
}
