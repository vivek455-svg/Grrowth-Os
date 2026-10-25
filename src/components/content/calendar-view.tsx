"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { BarChart3, ChevronLeft, ChevronRight, Copy, ExternalLink, GripVertical, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useShell } from "@/components/app/shell-context";
import { ContentStatusBadge, PlatformBadge } from "@/components/app/badges";
import { ParamSelect, useSetParams } from "@/components/analytics/range-filter";
import { MarkPublishedDialog } from "./publish-dialogs";
import { duplicateContent, reschedule } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import type { CalendarEntry } from "@/server/queries/content";
import { cn } from "@/lib/utils";
import { CONTENT_STATUS_LABEL } from "@/lib/labels";
import type { Platform } from "@/db/schema";

type View = "month" | "week" | "list";

function EntryChip({ e, onPublish, compact }: { e: CalendarEntry; onPublish: (e: CalendarEntry) => void; compact?: boolean }) {
  const router = useRouter();
  const { run } = useAction();
  const draggable = e.status !== "published";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          draggable={draggable}
          onDragStart={(ev) => {
            ev.dataTransfer.setData("text/version-id", e.id);
            ev.dataTransfer.setData("text/time", e.date);
            ev.dataTransfer.effectAllowed = "move";
          }}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-left text-xs transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            e.status === "published" && "bg-muted/50",
            !e.hasBody && e.status !== "published" && "border-dashed border-warning/60",
          )}
          title={`${e.title} · ${CONTENT_STATUS_LABEL[e.status]}${e.hasBody ? "" : " · missing copy"}`}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", e.platform === "linkedin" ? "bg-chart-1" : "bg-chart-2")} aria-hidden />
          {!compact && <span className="num shrink-0 text-muted-foreground">{format(new Date(e.date), "HH:mm")}</span>}
          <span className={cn("truncate", e.status === "published" && "text-muted-foreground")}>{e.title}</span>
          {draggable && <GripVertical className="ml-auto size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/60" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="space-y-1 px-2 py-1.5">
          <p className="text-sm font-medium leading-snug">{e.title}</p>
          <div className="flex items-center gap-1.5">
            <PlatformBadge platform={e.platform} />
            <ContentStatusBadge status={e.status} />
          </div>
          {!e.hasBody && <p className="text-xs text-warning">No copy written yet</p>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push(`/content/${e.contentItemId}?v=${e.id}`)}>
          <Pencil /> Edit post
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => duplicateContent({ id: e.contentItemId }), { success: "Duplicated as a draft" })}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        {e.status !== "published" && (
          <DropdownMenuItem onSelect={() => onPublish(e)}>
            <Send /> Mark as published
          </DropdownMenuItem>
        )}
        {e.platformPostUrl && (
          <DropdownMenuItem asChild>
            <a href={e.platformPostUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open post
            </a>
          </DropdownMenuItem>
        )}
        {e.status === "published" && (
          <DropdownMenuItem onSelect={() => router.push(`/content/${e.contentItemId}?v=${e.id}#performance`)}>
            <BarChart3 /> View performance
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CalendarView({
  entries,
  unscheduled,
  view,
  anchor,
  pillars,
}: {
  entries: CalendarEntry[];
  unscheduled: { id: string; contentItemId: string; title: string; platform: Platform; status: string }[];
  view: View;
  anchor: string;
  pillars: { id: string; name: string }[];
}) {
  const set = useSetParams();
  const { openNewPost } = useShell();
  const [publishing, setPublishing] = useState<CalendarEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const anchorDate = new Date(`${anchor}T12:00:00`);

  const days =
    view === "week"
      ? eachDayOfInterval({ start: startOfWeek(anchorDate, { weekStartsOn: 1 }), end: endOfWeek(anchorDate, { weekStartsOn: 1 }) })
      : eachDayOfInterval({ start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }) });

  const move = (dir: -1 | 1) => {
    const next = view === "week" ? addWeeks(anchorDate, dir) : addMonths(anchorDate, dir);
    set({ date: format(next, "yyyy-MM-dd") });
  };

  function onDrop(day: Date, ev: React.DragEvent) {
    ev.preventDefault();
    setDropTarget(null);
    const id = ev.dataTransfer.getData("text/version-id");
    if (!id) return;
    const prev = ev.dataTransfer.getData("text/time");
    const t = prev ? new Date(prev) : null;
    const when = new Date(day);
    when.setHours(t ? t.getHours() : 9, t ? t.getMinutes() : 0, 0, 0);
    startTransition(async () => {
      const res = await reschedule({ id, plannedAt: when });
      if (res.ok) toast.success(`Moved to ${format(when, "EEE, MMM d · HH:mm")}`);
      else toast.error(res.error);
    });
  }

  const quickAdd = (day: Date) => {
    const d = new Date(day);
    d.setHours(9, 0, 0, 0);
    openNewPost({ plannedAt: d });
  };

  const title = view === "week" ? `Week of ${format(days[0]!, "MMM d, yyyy")}` : format(anchorDate, "MMMM yyyy");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => set({ date: null })}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label="Next">
            <ChevronRight />
          </Button>
        </div>
        <h2 className="min-w-40 text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ParamSelect param="platform" placeholder="All platforms" className="w-36" options={[{ value: "linkedin", label: "LinkedIn" }, { value: "x", label: "X" }]} />
          <ParamSelect param="status" placeholder="All statuses" className="w-36" options={Object.entries(CONTENT_STATUS_LABEL).filter(([k]) => k !== "archived").map(([value, label]) => ({ value, label }))} />
          <ParamSelect param="pillar" placeholder="All pillars" className="w-44" options={pillars.map((p) => ({ value: p.id, label: p.name }))} />
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set({ view: v === "month" ? null : v })} aria-label="Calendar view">
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="list">List</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_240px]">
        {view === "list" ? (
          <Card className="gap-0 p-0">
            {entries.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">Nothing planned or published this month.</p>
            ) : (
              <ul className="divide-y">
                {entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="num w-36 shrink-0 text-xs text-muted-foreground">{format(new Date(e.date), "EEE, MMM d · HH:mm")}</span>
                    <PlatformBadge platform={e.platform} />
                    <Link href={`/content/${e.contentItemId}?v=${e.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      {e.title}
                    </Link>
                    {!e.hasBody && e.status !== "published" && <Badge variant="outline" className="border-dashed text-warning">Missing copy</Badge>}
                    <ContentStatusBadge status={e.status} />
                    <EntryChipMenuButton e={e} onPublish={setPublishing} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card className={cn("gap-0 overflow-hidden p-0 transition-opacity", isPending && "opacity-70")}>
            <div className="grid grid-cols-7 border-b bg-muted/40 text-xs text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="px-2 py-1.5 font-medium">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const list = entries.filter((e) => isSameDay(new Date(e.date), day));
                const outside = view === "month" && !isSameMonth(day, anchorDate);
                return (
                  <div
                    key={key}
                    onDragOver={(ev) => {
                      ev.preventDefault();
                      setDropTarget(key);
                    }}
                    onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                    onDrop={(ev) => onDrop(day, ev)}
                    className={cn(
                      "group/day relative flex flex-col gap-1 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
                      view === "week" ? "min-h-72" : "min-h-28",
                      outside && "bg-muted/30",
                      dropTarget === key && "bg-info-soft",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "num inline-flex size-6 items-center justify-center rounded-full text-xs",
                          isToday(day) && "bg-primary font-medium text-primary-foreground",
                          outside && "text-muted-foreground",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      <button
                        type="button"
                        onClick={() => quickAdd(day)}
                        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                        aria-label={`Add post on ${format(day, "MMMM d")}`}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    {list.map((e) => (
                      <EntryChip key={e.id} e={e} onPublish={setPublishing} />
                    ))}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card size="sm" className="h-fit">
          <div className="px-3">
            <p className="text-sm font-medium">Unscheduled</p>
            <p className="text-xs text-muted-foreground">Drag onto a day to plan it.</p>
          </div>
          <div className="space-y-1 px-3">
            {unscheduled.length === 0 && <p className="py-3 text-xs text-muted-foreground">No unscheduled drafts.</p>}
            {unscheduled.map((u) => (
              <div
                key={u.id}
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData("text/version-id", u.id)}
                className="flex cursor-grab items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-xs hover:bg-muted/40 active:cursor-grabbing"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", u.platform === "linkedin" ? "bg-chart-1" : "bg-chart-2")} aria-hidden />
                <Link href={`/content/${u.contentItemId}?v=${u.id}`} className="truncate hover:underline" draggable={false}>
                  {u.title}
                </Link>
                <span className="ml-auto shrink-0 text-muted-foreground">{u.status}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-3 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-chart-1" />LinkedIn</span>
            <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-chart-2" />X</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-4 rounded-sm border border-dashed border-warning/60" />Missing copy</span>
          </div>
        </Card>
      </div>

      {publishing && (
        <MarkPublishedDialog versionId={publishing.id} platform={publishing.platform} open onOpenChange={(o) => !o && setPublishing(null)} />
      )}
      <p className="text-xs text-muted-foreground">
        Drag a planned post to another day to reschedule it (time of day is kept). Published posts stay fixed. Nothing here posts automatically.
      </p>
    </div>
  );
}

function EntryChipMenuButton({ e, onPublish }: { e: CalendarEntry; onPublish: (e: CalendarEntry) => void }) {
  return (
    <div className="w-40">
      <EntryChip e={e} onPublish={onPublish} compact />
    </div>
  );
}

