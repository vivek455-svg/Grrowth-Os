import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { Composer, type ComposerContext } from "@/components/outreach/composer";
import { loadForUser } from "@/server/page";
import { aiStatus } from "@/server/ai";
import { conversationEvents, integrations, outreachCampaigns, outreachMessages, profiles, prospectResearch, prospects, suppressionList, type Channel } from "@/db/schema";
import { cooldownBlock, suppressionReason } from "@/lib/domain/outreach-rules";

export const metadata = { title: "Outreach composer" };

export default async function ComposePage({ searchParams }: PageProps<"/outreach/compose">) {
  const sp = await searchParams;
  const prospectId = typeof sp.prospect === "string" && /^[0-9a-f-]{36}$/i.test(sp.prospect) ? sp.prospect : null;
  const channel = sp.channel === "email" || sp.channel === "linkedin" || sp.channel === "x" ? (sp.channel as Channel) : null;
  const kind = sp.kind === "follow_up" ? "follow_up" : sp.kind === "connection_request" ? "connection_request" : "initial";

  const data = await loadForUser(async (tx, user) => {
    const campaigns = await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).orderBy(asc(outreachCampaigns.name));
    const [gmail] = await tx.select().from(integrations).where(and(eq(integrations.provider, "gmail"), eq(integrations.status, "connected")));
    if (!prospectId) return { ctx: null, campaigns, gmail: !!gmail };
    const [p] = await tx.select().from(prospects).where(eq(prospects.id, prospectId));
    if (!p) return { ctx: null, campaigns, gmail: !!gmail };
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
    const [research] = await tx.select().from(prospectResearch).where(eq(prospectResearch.prospectId, p.id)).orderBy(desc(prospectResearch.createdAt)).limit(1);
    const recent = await tx
      .select()
      .from(conversationEvents)
      .where(and(eq(conversationEvents.prospectId, p.id), inArray(conversationEvents.direction, ["inbound", "outbound"])))
      .orderBy(desc(conversationEvents.occurredAt))
      .limit(10);
    const messages = await tx.select().from(outreachMessages).where(eq(outreachMessages.prospectId, p.id)).orderBy(desc(outreachMessages.createdAt));
    const lastOut = recent.find((e) => e.direction === "outbound");
    const lastIn = recent.find((e) => e.direction === "inbound");
    const ctx: ComposerContext = {
      prospect: p,
      research: research ? { reviewStatus: research.reviewStatus, whatTheyDo: research.whatTheyDo, observations: research.observations, url: research.url } : null,
      recent,
      blocked: suppressionReason(p, await tx.select().from(suppressionList)),
      cooldown: cooldownBlock(p.lastContactedAt, profile?.outreachCooldownDays ?? 30),
      replyPending: !!lastIn && (!lastOut || lastIn.occurredAt > lastOut.occurredAt),
      messages,
    };
    return { ctx, campaigns, gmail: !!gmail };
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Outreach composer" description="Research-backed, personal messages. You approve every message; you choose how it's sent." />
      <Composer
        key={prospectId ?? "none"}
        ctx={data.ctx}
        aiEnabled={aiStatus().connected}
        gmailConnected={data.gmail}
        campaigns={data.campaigns}
        initialChannel={channel}
        initialKind={kind}
        initialMessageId={typeof sp.message === "string" ? sp.message : null}
        initialCampaignId={typeof sp.campaign === "string" ? sp.campaign : null}
      />
    </div>
  );
}
