"use client";

import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  Globe,
  Briefcase,
  Repeat,
  StickyNote,
  Trash2,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { updateEventSentiment, deleteEvent } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import { fmtDateTime } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL } from "@/lib/labels";
import type { ConversationEvent, EventType } from "@/db/schema";
import { cn } from "@/lib/utils";

const ICON: Partial<Record<EventType, LucideIcon>> = {
  profile_researched: UserSearch,
  website_audited: Globe,
  follow_up_scheduled: CalendarClock,
  call_booked: CalendarCheck,
  note: StickyNote,
  status_changed: Repeat,
  opportunity_created: Briefcase,
};

function SourceBadge({ source }: { source: ConversationEvent["source"] }) {
  if (source === "system") return null;
  return (
    <Badge variant="outline" className={cn("font-normal", source === "manual" && "border-dashed")}>
      {source === "synced" ? "Synced" : "Logged manually"}
    </Badge>
  );
}

export function Timeline({ events }: { events: ConversationEvent[] }) {
  const { run, pending } = useAction();
  const [filter, setFilter] = useState("all");
  const shown = events.filter((e) => (filter === "all" ? true : filter === "messages" ? e.direction !== "internal" : e.direction === "internal"));
  return (
    <div className="space-y-3">
      <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v)} aria-label="Filter timeline">
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="messages">Messages</ToggleGroupItem>
        <ToggleGroupItem value="activity">Activity</ToggleGroupItem>
      </ToggleGroup>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l pl-5">
          {shown.map((e) => {
            const Icon = e.direction === "outbound" ? ArrowUpRight : e.direction === "inbound" ? ArrowDownLeft : (ICON[e.type] ?? StickyNote);
            return (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    "absolute top-0.5 -left-[29px] flex size-[18px] items-center justify-center rounded-full border bg-background",
                    e.direction === "inbound" && "border-info text-info",
                    e.direction === "outbound" && "text-foreground",
                    e.direction === "internal" && "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3" />
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{EVENT_LABEL[e.type]}</span>
                  {e.channel && <span className="text-xs text-muted-foreground">{CHANNEL_LABEL[e.channel]}</span>}
                  <span className="num text-xs text-muted-foreground">{fmtDateTime(e.occurredAt)}</span>
                  <SourceBadge source={e.source} />
                  {e.deliveryStatus && e.deliveryStatus !== "sent" && <Badge variant="destructive">{e.deliveryStatus}</Badge>}
                  {e.source === "manual" && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto text-muted-foreground"
                      aria-label="Delete entry"
                      disabled={pending}
                      onClick={() => run(() => deleteEvent({ id: e.id }), { success: "Entry deleted" })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {e.content && <p className="mt-1 max-w-prose text-sm whitespace-pre-line text-muted-foreground">{e.content}</p>}
                {e.notes && <p className="mt-1 text-xs text-muted-foreground">{e.notes}</p>}
                {e.direction === "inbound" && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Reply classification</span>
                    <Select
                      value={e.sentiment ?? "none"}
                      onValueChange={(v) => run(() => updateEventSentiment({ id: e.id, sentiment: v === "none" ? null : (v as "positive") }), { success: "Classification saved" })}
                    >
                      <SelectTrigger size="sm" className="h-7 w-36 text-xs" aria-label="Reply classification">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        <SelectItem value="positive">Positive</SelectItem>
                        <SelectItem value="neutral">Neutral</SelectItem>
                        <SelectItem value="negative">Negative</SelectItem>
                        <SelectItem value="opt_out">Opt-out</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
