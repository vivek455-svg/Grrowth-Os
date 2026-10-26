"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Lightbulb, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { insightToIdea, setInsightStatus, setRecommendationStatus } from "@/server/actions/insights";
import type { aiInsights, aiRecommendations } from "@/db/schema";
import { cn } from "@/lib/utils";

type Insight = typeof aiInsights.$inferSelect;
type Recommendation = typeof aiRecommendations.$inferSelect;

function Evidence({ data }: { data: Record<string, unknown> }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        Supporting data <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(data, (_, v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(4)) : v), 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RecommendationList({ items, emptyNote }: { items: Recommendation[]; emptyNote?: string }) {
  const { run, pending } = useAction();
  if (!items.length)
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyNote ?? "No recommendations right now. They appear as your data grows."}</p>;
  return (
    <ul className="divide-y">
      {items.map((r, i) => (
        <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {/* The single highest-priority action gets the accent dot. */}
                {i === 0 && <span className="size-1.5 shrink-0 rounded-full bg-brand" role="img" aria-label="Top priority" />}
                {r.title}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{r.reasoning}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Mark done" onClick={() => run(() => setRecommendationStatus({ id: r.id, status: "done" }))}>
                    <Check />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mark done</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Dismiss" onClick={() => run(() => setRecommendationStatus({ id: r.id, status: "dismissed" }))}>
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Evidence data={r.evidence} />
            {r.actionHref && (
              <Button asChild size="xs" variant="outline">
                <Link href={r.actionHref}>
                  {r.actionLabel ?? "Open"} <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const confidenceTone = { low: "border-dashed", medium: "", high: "" } as const;

export function InsightList({ items, notes }: { items: Insight[]; notes: string[] }) {
  const { run, pending } = useAction();
  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No patterns are strong enough to report yet. Insights appear only when the data supports them.</p>
      )}
      <ul className="divide-y">
        {items.map((i) => (
          <li key={i.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Lightbulb className="size-3.5 text-muted-foreground" />
              <p className="text-sm font-medium">{i.title}</p>
              <Badge variant="outline" className={cn("font-normal", confidenceTone[i.confidence])}>
                {i.confidence} confidence · n={i.sampleSize}
              </Badge>
              {i.status === "useful" && <Badge variant="secondary">Marked useful</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{i.body}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Evidence data={i.evidence} />
              <div className="flex items-center gap-1">
                <Button size="xs" variant="ghost" disabled={pending || i.status === "useful"} onClick={() => run(() => setInsightStatus({ id: i.id, status: "useful" }), { success: "Marked as useful" })}>
                  <ThumbsUp /> Useful
                </Button>
                <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => insightToIdea({ id: i.id }), { success: "Saved as a content idea" })}>
                  <Lightbulb /> Make idea
                </Button>
                <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setInsightStatus({ id: i.id, status: "dismissed" }))}>
                  <X /> Dismiss
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <ul className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
