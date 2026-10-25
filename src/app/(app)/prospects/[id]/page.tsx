import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { ProspectDetail } from "@/components/prospects/prospect-detail";
import { loadForUser } from "@/server/page";
import { prospectDetail } from "@/server/queries/prospects";
import { aiStatus } from "@/server/ai";
import { outreachCampaigns } from "@/db/schema";

export const metadata = { title: "Prospect" };

export default async function ProspectPage({ params }: PageProps<"/prospects/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadForUser(async (tx) => ({
    d: await prospectDetail(tx, id),
    campaigns: await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).orderBy(asc(outreachCampaigns.name)),
  }));
  if (!data.d) notFound();
  return <ProspectDetail d={data.d} aiEnabled={aiStatus().connected} campaigns={data.campaigns} />;
}
