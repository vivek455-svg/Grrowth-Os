import { asc, desc, isNull } from "drizzle-orm";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { loadForUser } from "@/server/page";
import { pipeline } from "@/server/queries/outreach";
import { contentItems, outreachCampaigns } from "@/db/schema";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { daysAgoMs } from "@/lib/metrics/period";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const data = await loadForUser(async (tx) => ({
    ...(await pipeline(tx)),
    campaigns: await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).orderBy(asc(outreachCampaigns.name)),
    content: await tx.select({ id: contentItems.id, title: contentItems.title }).from(contentItems).where(isNull(contentItems.archivedAt)).orderBy(desc(contentItems.createdAt)).limit(200),
  }));
  const kind = new Map(data.stages.map((s) => [s.key, s.kind]));
  const openRows = data.rows.filter((r) => kind.get(r.o.stage) === "open");
  const ninety = daysAgoMs(90);
  const won90 = data.rows.filter((r) => kind.get(r.o.stage) === "won" && r.o.closedAt && r.o.closedAt.getTime() >= ninety);
  const closed = data.rows.filter((r) => kind.get(r.o.stage) !== "open");
  const wonAll = closed.filter((r) => kind.get(r.o.stage) === "won").length;
  // Sums only include USD so we never add different currencies together.
  const usd = (rs: typeof data.rows) => rs.filter((r) => r.o.currency === "USD").reduce((a, r) => a + (r.o.valueCents ?? 0), 0);
  const otherCurrencies = new Set(data.rows.map((r) => r.o.currency).filter((c) => c !== "USD"));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Opportunities"
        description="A lightweight pipeline. Values and rates come only from what you record."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/opportunities" download>
              <Download /> Export
            </a>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open opportunities" value={fmtNumber(openRows.length)} footnote={`${openRows.filter((r) => r.o.valueCents == null).length} without a value`} />
        <StatCard label="Open pipeline value" value={fmtMoney(usd(openRows))} hint="Sum of estimated values for open opportunities in USD. Not probability-weighted." footnote={otherCurrencies.size ? `Excludes ${[...otherCurrencies].join(", ")}` : "Estimated, unweighted"} />
        <StatCard label="Won · last 90 days" value={fmtMoney(usd(won90))} footnote={`${won90.length} project${won90.length === 1 ? "" : "s"}`} />
        <StatCard
          label="Win rate"
          value={closed.length >= 5 ? fmtPercent(wonAll / closed.length) : "—"}
          muted={closed.length < 5}
          hint="Won ÷ (won + lost), all time."
          footnote={closed.length >= 5 ? `${wonAll} of ${closed.length} closed` : `Needs 5+ closed (have ${closed.length})`}
        />
      </div>
      <PipelineBoard stages={data.stages} rows={data.rows} touchpoints={data.touchpoints} campaigns={data.campaigns} content={data.content} />
    </div>
  );
}
