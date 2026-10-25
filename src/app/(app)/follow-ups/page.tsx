import Link from "next/link";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { FollowUpRows, WaitingRows, type FollowUpItem } from "@/components/outreach/follow-up-list";
import { loadForUser } from "@/server/page";
import { followUpBuckets } from "@/server/queries/outreach";
import { fmtDate, fmtMoney } from "@/lib/format";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage() {
  const b = await loadForUser((tx) => followUpBuckets(tx));
  const toItem = (x: (typeof b.today)[number]): FollowUpItem => ({
    id: x.f.id,
    dueAt: x.f.dueAt,
    reason: x.f.reason,
    prospectId: x.p.id,
    name: x.p.fullName,
    company: x.p.company,
    lastOutContent: x.lastOutContent,
    channel: x.channel,
  });

  const section = (title: string, desc: string, count: number, children: React.ReactNode, id?: string) => (
    <Card className="gap-0 py-0" id={id}>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
        <CardAction>
          <Badge variant={count ? "secondary" : "outline"} className="num">{count}</Badge>
        </CardAction>
      </CardHeader>
      {children}
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-ups"
        description="Who to nudge, who's waiting, and what's gone quiet. Nothing is sent automatically, and anyone who replied or opted out is excluded."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          {section("Overdue", "Past their due date", b.overdue.length, <FollowUpRows items={b.overdue.map(toItem)} tone="danger" />)}
          {section("Due today", "Scheduled for today", b.today.length, <FollowUpRows items={b.today.map(toItem)} />)}
          {section("Next 7 days", "Coming up", b.week.length, <FollowUpRows items={b.week.map(toItem)} />)}
        </div>
        <div className="space-y-4">
          {section(
            "Waiting for a response",
            "Contacted 3+ days ago, no reply, no follow-up scheduled",
            b.waiting.length,
            <WaitingRows items={b.waiting.map((w) => ({ prospectId: w.p.id, name: w.p.fullName, company: w.p.company, lastOut: w.lastOut, lastOutContent: w.lastOutContent, suggested: w.suggested }))} />,
          )}
          {section(
            "Interested, no next step",
            "Positive reply but no follow-up or open opportunity",
            b.interestedNoStep.length,
            b.interestedNoStep.length ? (
              <ul className="divide-y">
                {b.interestedNoStep.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/prospects/${p.id}`} className="font-medium hover:underline">{p.fullName}</Link>
                    <span className="text-xs text-muted-foreground">{p.company}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">Every interested prospect has a next step.</p>
            ),
            "no-next-step",
          )}
          {section(
            "Gone quiet",
            "Two-way conversations with no activity for 14+ days",
            b.quiet.length,
            b.quiet.length ? (
              <ul className="divide-y">
                {b.quiet.map(({ p, lastActivity }) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/prospects/${p.id}`} className="font-medium hover:underline">{p.fullName}</Link>
                    <span className="text-xs text-muted-foreground">Last activity {fmtDate(lastActivity)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">No conversations have stalled.</p>
            ),
          )}
          {section(
            "Opportunities without recent activity",
            "Open opportunities untouched for 14+ days",
            b.staleOpps.length,
            b.staleOpps.length ? (
              <ul className="divide-y">
                {b.staleOpps.map(({ o, stageLabel }) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/opportunities?open=${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                    <span className="text-xs text-muted-foreground">{stageLabel} · {fmtMoney(o.valueCents, o.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">All open opportunities are active.</p>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
