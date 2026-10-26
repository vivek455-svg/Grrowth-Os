import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { loadForUser } from "@/server/page";
import { profiles } from "@/db/schema";
import { aiStatus } from "@/server/ai";
import { integrationDef } from "@/server/integrations/registry";
import { LogoMark } from "@/components/app/logo-mark";

export const metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const profile = await loadForUser(async (tx, user) => (await tx.select().from(profiles).where(eq(profiles.id, user.id)))[0]);
  if (profile?.onboardingCompletedAt) redirect("/");
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <div className="mb-8 flex items-center gap-2">
        <LogoMark />
        <span className="text-sm font-semibold">Growth OS</span>
      </div>
      <OnboardingWizard
        defaults={{ fullName: profile?.fullName ?? "", email: profile?.email ?? null }}
        configured={{ ai: aiStatus().connected, x: integrationDef("x")!.configured(), linkedin: integrationDef("linkedin")!.configured(), gmail: integrationDef("gmail")!.configured() }}
      />
    </main>
  );
}
