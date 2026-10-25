import { asc, desc, isNotNull } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { DiscoveryView } from "@/components/outreach/discovery-view";
import { loadForUser } from "@/server/page";
import { aiStatus } from "@/server/ai";
import { searchProvider } from "@/server/integrations/providers";
import { discoveryRuns, outreachCampaigns, prospectSources } from "@/db/schema";

export const metadata = { title: "Prospect Discovery" };

export default async function DiscoveryPage() {
  const data = await loadForUser(async (tx) => ({
    candidates: await tx.select().from(prospectSources).where(isNotNull(prospectSources.discoveryRunId)).orderBy(desc(prospectSources.createdAt)).limit(200),
    runs: await tx.select().from(discoveryRuns).orderBy(desc(discoveryRuns.createdAt)).limit(10),
    campaigns: await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).orderBy(asc(outreachCampaigns.name)),
  }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Prospect Discovery"
        description="Find businesses that could use better landing pages or Framer help — from public pages and authorized sources only."
      />
      <DiscoveryView aiEnabled={aiStatus().connected} searchEnabled={!!searchProvider()} candidates={data.candidates} runs={data.runs} campaigns={data.campaigns} />
    </div>
  );
}
