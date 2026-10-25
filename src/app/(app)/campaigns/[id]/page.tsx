import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/app/stat-card";
import { FitScore, LeadStatusBadge, MessageStatusBadge } from "@/components/app/badges";
import { ApproveButton, CampaignActions, CampaignActivityChart, MemberActions } from "@/components/outreach/campaign-components";
import { loadForUser } from "@/server/page";
import { campaignDetail } from "@/server/queries/outreach";
import { fmtDate, fmtMoney, fmtPercent, fmtRelative } from "@/lib/format";
import { CAMPAIGN_STATUS_LABEL, CHANNEL_LABEL } from "@/lib/labels";
import type { Rate } from "@/lib/metrics/outreach";

export const metadata = { title: "Campaign" };

const rate = (r: Rate) => (r.denominator ? fmtPercent(r.value) : "—");
const foot = (r: Rate) => (r.denominator ? `${r.numerator} of ${r.denominator}${r.sufficient ? "" : " · small sample"}` : "No one contacted yet");

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await loadForUser((tx) => campaignDetail(tx, id));
  if (!d) notFound();
  const { c, stats } = d;
  const s = stats.s;
  const statusMap = new Map(d.statuses.map((x) => [x.key, x]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="xs" className="-ml-2 mb-1 text-muted-foreground">
            <Link href="/campaigns"><ArrowLeft /> Campaigns</Link>
          </Button>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {c.name}
            <Badge variant={c.status === "active" ? "secondary" : "outline"} className="font-normal">{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {CHANNEL_LABEL[c.channel as "email"] ?? "Mixed channels"}
            {c.startDate ? ` · ${fmtDate(c.startDate)}${c.endDate ? ` – ${fmtDate(c.endDate)}` : ""}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CampaignActions campaign={c} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Prospects" value={stats.members} footnote={`${stats.queued} awaiting outreach`} />
        <StatCard label="Contacted" value={s.contacted} footnote={`${s.messagesSent} messages sent`} />
        <StatCard label="Reply rate" value={rate(s.replyRate)} footnote={foot(s.replyRate)} />
        <StatCard label="Positive replies" value={rate(s.positiveReplyRate)} footnote={foot(s.positiveReplyRate)} />
        <StatCard label="Meetings" value={s.callsBooked} footnote={foot(s.meetingRate)} />
        <StatCard label="Won" value={s.won} footnote={s.wonValueCents ? fmtMoney(s.wonValueCents) : `${s.qualifiedOpportunities} opportunities`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity by week</CardTitle>
            <CardDescription>Messages sent and replies received for this campaign.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.timeline.length ? <CampaignActivityChart data={d.timeline} /> : <p className="py-10 text-center text-sm text-muted-foreground">No activity yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Strategy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[["Audience", c.targetAudience], ["Criteria", c.criteria], ["Message strategy", c.messageStrategy], ["Description", c.description]].map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="whitespace-pre-line">{v || "—"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Review queue</CardTitle>
          <CardDescription>Drafts for this campaign. Each message is approved individually — there's no bulk send.</CardDescription>
        </CardHeader>
        {d.queue.length === 0 ? (
          <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">No drafts waiting. Use “Draft” next to a prospect below.</p>
        ) : (
          <ul className="divide-y border-t">
            {d.queue.map(({ m, prospectName }) => (
              <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{prospectName}</span>
                    <MessageStatusBadge status={m.status} />
                    <span className="text-xs text-muted-foreground">{CHANNEL_LABEL[m.channel]}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{m.body}</p>
                </div>
                <div className="flex gap-1">
                  {m.status === "draft" && <ApproveButton id={m.id} />}
                  <Button asChild size="xs" variant="outline">
                    <Link href={`/outreach/compose?prospect=${m.prospectId}&message=${m.id}`}>{m.status === "draft" ? "Edit" : "Send"}</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="gap-0 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Prospect</TableHead>
              <TableHead>Lead status</TableHead>
              <TableHead>Campaign state</TableHead>
              <TableHead className="hidden md:table-cell">Fit</TableHead>
              <TableHead className="hidden md:table-cell">Last contact</TableHead>
              <TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.members.map(({ cp, p }) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <Link href={`/prospects/${p.id}`} className="font-medium hover:underline">{p.fullName}</Link>
                  <p className="text-xs text-muted-foreground">{p.company}</p>
                </TableCell>
                <TableCell><LeadStatusBadge label={statusMap.get(p.status)?.label ?? p.status} category={statusMap.get(p.status)?.category} /></TableCell>
                <TableCell><Badge variant="outline" className="font-normal">{cp.state}</Badge></TableCell>
                <TableCell className="hidden md:table-cell"><FitScore score={p.fitScore} /></TableCell>
                <TableCell className="num hidden text-muted-foreground md:table-cell">{p.lastContactedAt ? fmtRelative(p.lastContactedAt) : "Never"}</TableCell>
                <TableCell className="pr-4"><MemberActions campaignId={c.id} prospectId={p.id} channel={c.channel} /></TableCell>
              </TableRow>
            ))}
            {d.members.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No prospects yet. Add them from the Prospects page.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
