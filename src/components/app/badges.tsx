import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Channel, ContentStatus, MessageStatus, MetricSource, Platform } from "@/db/schema";
import { CHANNEL_LABEL, CONTENT_STATUS_LABEL, MESSAGE_STATUS_LABEL, PLATFORM_LABEL } from "@/lib/labels";

const dot = "before:mr-1 before:inline-block before:size-1.5 before:rounded-full before:content-['']";

export function PlatformBadge({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", className)}>
      <span className={cn("size-1.5 rounded-full", platform === "linkedin" ? "bg-chart-1" : "bg-chart-2")} aria-hidden />
      {PLATFORM_LABEL[platform]}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <Badge variant="outline" className="font-normal">
      {CHANNEL_LABEL[channel]}
    </Badge>
  );
}

const contentTone: Record<ContentStatus, string> = {
  idea: "before:bg-muted-foreground/40",
  draft: "before:bg-muted-foreground",
  ready: "before:bg-info",
  scheduled: "before:bg-warning",
  published: "before:bg-success",
  archived: "before:bg-border",
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", dot, contentTone[status])}>
      {CONTENT_STATUS_LABEL[status]}
    </Badge>
  );
}

const msgTone: Partial<Record<MessageStatus, string>> = {
  draft: "before:bg-muted-foreground",
  approved: "before:bg-info",
  sending: "before:bg-warning",
  sent: "before:bg-success",
  delivered: "before:bg-success",
  failed: "before:bg-destructive",
  bounced: "before:bg-destructive",
  cancelled: "before:bg-border",
};

export function MessageStatusBadge({ status, method }: { status: MessageStatus; method?: "api" | "manual" | null }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", dot, msgTone[status])}>
      {MESSAGE_STATUS_LABEL[status]}
      {method === "manual" && (status === "sent" || status === "delivered") && <span className="text-muted-foreground">· logged</span>}
    </Badge>
  );
}

const sourceLabel: Record<MetricSource, string> = { api: "API", manual: "Manual", csv: "CSV", estimated: "Estimated" };

/** Distinguishes platform-reported metrics from manual, imported, or estimated ones. */
export function MetricSourceBadge({ source }: { source: MetricSource | null | undefined }) {
  if (!source) return <span className="text-xs text-muted-foreground">No metrics</span>;
  return (
    <Badge variant={source === "api" ? "secondary" : "outline"} className={cn("font-normal", source === "estimated" && "border-dashed")}>
      {sourceLabel[source]}
    </Badge>
  );
}

export function LeadStatusBadge({ label, category }: { label: string; category?: string }) {
  const tone =
    category === "won"
      ? "before:bg-success"
      : category === "lost" || category === "excluded"
        ? "before:bg-muted-foreground/50"
        : category === "active"
          ? "before:bg-info"
          : "before:bg-muted-foreground";
  return (
    <Badge variant="secondary" className={cn("font-normal", dot, tone)}>
      {label}
    </Badge>
  );
}

export function FitScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = score >= 75 ? "bg-success" : score >= 50 ? "bg-info" : "bg-muted-foreground/50";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${score}%` }} />
      </span>
      <span className="num text-xs">{score}</span>
    </span>
  );
}
