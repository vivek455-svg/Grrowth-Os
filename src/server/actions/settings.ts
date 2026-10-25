"use server";

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { contentPillars, portfolioProjects, profiles } from "@/db/schema";
import { defineAction, optionalText, optionalUrl } from "@/server/action";
import { asService } from "@/db/client";
import { requireUser } from "@/server/auth";
import { supabaseConfigured } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { log } from "@/lib/logger";
import type { ActionResult } from "@/server/action";

const list = z.array(z.string().trim().min(1).max(200)).max(30);

export const updateProfile = defineAction(
  "settings.profile",
  z.object({
    fullName: optionalText(200),
    businessName: optionalText(200),
    positioning: optionalText(2000),
    services: list.optional(),
    targetAudiences: list.optional(),
    writingPreferences: optionalText(3000),
    timezone: z.string().max(60).optional(),
    engagementRateDenominator: z.enum(["impressions", "followers"]).optional(),
    outreachCooldownDays: z.coerce.number().int().min(0).max(365).optional(),
    dailySendLimit: z.coerce.number().int().min(0).max(500).optional(),
  }),
  async (input, { tx, user }) => {
    const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    await tx.update(profiles).set(fields).where(eq(profiles.id, user.id));
    return null;
  },
);

export const savePortfolioProject = defineAction(
  "settings.portfolio",
  z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    url: optionalUrl,
    description: optionalText(2000),
    services: list.default([]),
    industries: list.default([]),
    verifiedOutcomes: optionalText(1000),
  }),
  async ({ id, ...input }, { tx }) => {
    if (id) await tx.update(portfolioProjects).set(input).where(eq(portfolioProjects.id, id));
    else await tx.insert(portfolioProjects).values(input);
    return null;
  },
);

export const deletePortfolioProject = defineAction("settings.portfolio_delete", z.object({ id: z.string().uuid() }), async ({ id }, { tx }) => {
  await tx.delete(portfolioProjects).where(eq(portfolioProjects.id, id));
  return null;
});

/** Onboarding: saves everything collected so far and marks onboarding complete. */
export const completeOnboarding = defineAction(
  "onboarding.complete",
  z.object({
    fullName: optionalText(200),
    businessName: optionalText(200),
    positioning: optionalText(2000),
    services: list,
    targetAudiences: list,
    writingPreferences: optionalText(3000),
    pillars: z.array(z.string().trim().min(1).max(80)).max(15),
    portfolio: z.array(z.object({ name: z.string().trim().min(1).max(200), url: optionalUrl })).max(10),
  }),
  async (input, { tx, user }) => {
    await tx
      .update(profiles)
      .set({
        fullName: input.fullName,
        businessName: input.businessName,
        positioning: input.positioning,
        services: input.services,
        targetAudiences: input.targetAudiences,
        writingPreferences: input.writingPreferences,
        onboardingCompletedAt: new Date(),
      })
      .where(eq(profiles.id, user.id));
    const unique = [...new Set(input.pillars)];
    if (unique.length)
      await tx
        .insert(contentPillars)
        .values(unique.map((name, i) => ({ name, sortOrder: i * 10 })))
        .onConflictDoNothing();
    if (input.portfolio.length) await tx.insert(portfolioProjects).values(input.portfolio);
    return null;
  },
);

/**
 * Permanently deletes the account and every owned record (cascading from auth.users).
 * Requires typing DELETE. Integration tokens are revoked by the cascade (credentials are deleted).
 */
export async function deleteAccount(input: { confirm: string }): Promise<ActionResult<null>> {
  if (input.confirm !== "DELETE") return { ok: false, error: "Type DELETE to confirm." };
  const user = await requireUser();
  try {
    await asService(async (db) => {
      await db.execute(sql`delete from auth.users where id = ${user.id}`);
    });
    log("info", "account_deleted", { userId: user.id });
  } catch (e) {
    log("error", "account_delete_failed", { userId: user.id, error: e });
    return { ok: false, error: "Couldn't delete the account. Nothing was removed." };
  }
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
    redirect("/login");
  }
  redirect("/onboarding");
}
