"use client";

import Link from "next/link";
import { addDays } from "date-fns";
import { Check, Clock, MessageSquarePlus, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { scheduleFollowUp, updateFollowUp } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import { fmtDate, fmtDateTime, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/app/time-ago";

export type FollowUpItem = {
  id: string;
  dueAt: Date;
  reason: string | null;
  prospectId: string;
  name: string;
  company: string | null;
  lastOutContent: string | null;
  channel: string | null;
};

export function FollowUpRows({ items, tone }: { items: FollowUpItem[]; tone?: "danger" }) {
  const { run, pending } = useAction();
  if (!items.length) return <p className="px-4 py-5 text-sm text-muted-foreground">Nothing here.</p>;
  const snooze = (id: string, days: number) => {
    const d = addDays(new Date(), days);
    d.setHours(9, 0, 0, 0);
    run(() => updateFollowUp({ id, dueAt: d }), { success: `Snoozed ${days} day${days === 1 ? "" : "s"}` });
  };
  return (
    <ul className="divide-y">
      {items.map((f) => (
        <li key={f.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/prospects/${f.prospectId}`} className="font-medium hover:underline">{f.name}</Link>
              {f.company && <span className="text-xs text-muted-foreground">{f.company}</span>}
              <span className={cn("num text-xs", tone === "danger" ? "font-medium text-destructive" : "text-muted-foreground")}>
                {tone === "danger" ? <>Overdue · <TimeAgo date={f.dueAt} /></> : fmtDateTime(f.dueAt)}
              </span>
            </div>
            {f.reason && <p className="text-sm">{f.reason}</p>}
            {f.lastOutContent && <p className="text-xs text-muted-foreground">Last message: “{truncate(f.lastOutContent, 160)}”</p>}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button asChild size="xs">
              <Link href={`/outreach/compose?prospect=${f.prospectId}&kind=follow_up${f.channel ? `&channel=${f.channel}` : ""}`}>
                <MessageSquarePlus /> Draft follow-up
              </Link>
            </Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => updateFollowUp({ id: f.id, status: "done" }), { success: "Marked done" })}>
              <Check /> Done
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="ghost" disabled={pending}>
                  <Clock /> Snooze
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[1, 3, 7, 14].map((d) => (
                  <DropdownMenuItem key={d} onSelect={() => snooze(f.id, d)}>
                    {d === 1 ? "Tomorrow" : `${d} days`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => updateFollowUp({ id: f.id, status: "skipped" }), { success: "Skipped" })}>
              <SkipForward /> Skip
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WaitingRows({ items }: { items: { prospectId: string; name: string; company: string | null; lastOut: Date; lastOutContent: string | null; suggested: Date }[] }) {
  const { run, pending } = useAction();
  if (!items.length) return <p className="px-4 py-5 text-sm text-muted-foreground">No one is waiting without a follow-up.</p>;
  return (
    <ul className="divide-y">
      {items.map((w) => (
        <li key={w.prospectId} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/prospects/${w.prospectId}`} className="font-medium hover:underline">{w.name}</Link>
              {w.company && <span className="text-xs text-muted-foreground">{w.company}</span>}
              <span className="text-xs text-muted-foreground">· no reply since {fmtDate(w.lastOut)}</span>
            </div>
            {w.lastOutContent && <p className="text-xs text-muted-foreground">“{truncate(w.lastOutContent, 160)}”</p>}
          </div>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => scheduleFollowUp({ prospectId: w.prospectId, dueAt: w.suggested, reason: "Suggested: no reply to last message", suggested: true }), { success: "Follow-up scheduled" })}
          >
            Schedule for {fmtDate(w.suggested, "MMM d")} (suggested)
          </Button>
        </li>
      ))}
    </ul>
  );
}
