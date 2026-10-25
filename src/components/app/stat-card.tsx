import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtPercent } from "@/lib/format";

export function Hint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground/70 hover:text-foreground" aria-label="How this is calculated">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export function DeltaBadge({ change, invert = false }: { change: number | null; invert?: boolean }) {
  if (change === null) return null;
  const up = change >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-destructive")}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {fmtPercent(Math.abs(change), 0)}
      <span className="sr-only">{up ? "increase" : "decrease"} vs previous period</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  change,
  footnote,
  muted,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  change?: number | null;
  footnote?: ReactNode;
  muted?: boolean;
}) {
  return (
    <Card size="sm" className="gap-1.5 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {hint && <Hint>{hint}</Hint>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-xl font-semibold tracking-tight", muted && "text-muted-foreground")}>{value}</span>
        {change !== undefined && <DeltaBadge change={change ?? null} />}
      </div>
      {footnote && <div className="text-xs text-muted-foreground">{footnote}</div>}
    </Card>
  );
}
