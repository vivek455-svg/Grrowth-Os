"use server";

import { z } from "zod";
import { ilike, or, asc } from "drizzle-orm";
import { withUser } from "@/db/client";
import { prospects } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { searchEverything } from "@/server/queries/shell";
import { supabaseConfigured } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function globalSearch(q: string) {
  const query = z.string().trim().min(1).max(100).safeParse(q);
  if (!query.success) return { prospects: [], content: [], campaigns: [], opportunities: [] };
  const user = await requireUser();
  return withUser(user.id, (tx) => searchEverything(tx, query.data));
}

export async function findProspects(q: string) {
  const user = await requireUser();
  const term = `%${z.string().max(100).catch("").parse(q).replace(/[%_]/g, "")}%`;
  return withUser(user.id, (tx) =>
    tx
      .select({ id: prospects.id, name: prospects.fullName, company: prospects.company, status: prospects.status })
      .from(prospects)
      .where(or(ilike(prospects.fullName, term), ilike(prospects.company, term)))
      .orderBy(asc(prospects.fullName))
      .limit(20),
  );
}

export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
