import { asc, desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { loadForUser } from "@/server/page";
import { activityLogs, contentCampaigns, contentPillars, leadStatuses, portfolioProjects, profiles, suppressionList } from "@/db/schema";

export const metadata = { title: "Settings" };

const TABS = ["profile", "portfolio", "pillars", "statuses", "safety", "data"];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const d = await loadForUser(async (tx, user) => ({
    profile: (await tx.select().from(profiles).where(eq(profiles.id, user.id)))[0]!,
    portfolio: await tx.select().from(portfolioProjects).orderBy(asc(portfolioProjects.createdAt)),
    pillars: await tx.select().from(contentPillars).orderBy(asc(contentPillars.sortOrder)),
    contentCampaigns: await tx.select({ id: contentCampaigns.id, name: contentCampaigns.name, startDate: contentCampaigns.startDate, endDate: contentCampaigns.endDate }).from(contentCampaigns).orderBy(desc(contentCampaigns.createdAt)),
    statuses: await tx.select().from(leadStatuses).orderBy(asc(leadStatuses.sortOrder)),
    suppression: await tx.select().from(suppressionList).orderBy(desc(suppressionList.createdAt)),
    audit: await tx.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(50),
  }));
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your positioning, workspace configuration, safety rules and data." />
      <SettingsView {...d} tab={typeof sp.tab === "string" && TABS.includes(sp.tab) ? sp.tab : "profile"} />
    </div>
  );
}
