import Link from "next/link";
import { Download, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { NewCampaignButton } from "@/components/outreach/campaign-components";
import { loadForUser } from "@/server/page";
import { campaignStats } from "@/server/queries/outreach";
import { fmtPercent } from "@/lib/format";
import { CAMPAIGN_STATUS_LABEL, CHANNEL_LABEL } from "@/lib/labels";
import type { Rate } from "@/lib/metrics/outreach";

export const metadata = { title: "Campaigns" };

function RateCell({ r }: { r: Rate }) {
  if (!r.denominator) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {fmtPercent(r.value, 0)}
      <span className="ml-1 text-xs text-muted-foreground">({r.numerator}/{r.denominator})</span>
    </span>
  );
}

export default async function CampaignsPage() {
  const rows = await loadForUser((tx) => campaignStats(tx));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description="Group prospects around one message strategy and see what actually gets replies."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <a href="/api/export/campaigns" download>
                <Download /> Export
              </a>
            </Button>
            <NewCampaignButton />
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" description="Create one for each outreach angle, e.g. “SaaS landing page outreach” or “Framer agency partnerships”." />
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Prospects</TableHead>
                <TableHead className="text-right">Contacted</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
                <TableHead className="hidden text-right md:table-cell">Positive</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Meetings</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Opps</TableHead>
                <TableHead className="hidden pr-4 text-right lg:table-cell">Won</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ c, members, queued, s }) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="text-xs text-muted-foreground">{CHANNEL_LABEL[c.channel as "email"] ?? "Mixed"}{queued ? ` · ${queued} awaiting outreach` : ""}</p>
                  </TableCell>
                  <TableCell><Badge variant={c.status === "active" ? "secondary" : "outline"} className="font-normal">{CAMPAIGN_STATUS_LABEL[c.status]}</Badge></TableCell>
                  <TableCell className="num text-right">{members}</TableCell>
                  <TableCell className="num text-right">{s.contacted}</TableCell>
                  <TableCell className="num text-right"><RateCell r={s.replyRate} /></TableCell>
                  <TableCell className="num hidden text-right md:table-cell"><RateCell r={s.positiveReplyRate} /></TableCell>
                  <TableCell className="num hidden text-right lg:table-cell">{s.callsBooked}</TableCell>
                  <TableCell className="num hidden text-right lg:table-cell">{s.qualifiedOpportunities}</TableCell>
                  <TableCell className="num hidden pr-4 text-right lg:table-cell">{s.won}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Rates use unique prospects contacted in each campaign (all time). Under 5 contacted, treat rates as anecdotal.</p>
    </div>
  );
}
