import { endOfDay, startOfDay, subDays } from "date-fns";

/** Below this sample size, rates and patterns are shown as "insufficient data". */
export const MIN_SAMPLE = 5;

export type Period = { start: Date; end: Date };
export type RangeKey = "7d" | "30d" | "90d" | "custom";

export function periodFromRange(range: RangeKey, now = new Date(), custom?: { from?: string; to?: string }): Period {
  if (range === "custom" && custom?.from && custom?.to) {
    const start = startOfDay(new Date(custom.from));
    const end = endOfDay(new Date(custom.to));
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) return { start, end };
  }
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return { start: startOfDay(subDays(now, days - 1)), end: endOfDay(now) };
}

/** The equivalent period immediately before `p` (same length). */
export function previousPeriod(p: Period): Period {
  const length = p.end.getTime() - p.start.getTime();
  const end = new Date(p.start.getTime() - 1);
  return { start: new Date(end.getTime() - length), end };
}

export function inPeriod(d: Date, p: Period) {
  return d >= p.start && d <= p.end;
}

export function safeRate(numerator: number, denominator: number | null | undefined): number | null {
  if (denominator === null || denominator === undefined || denominator <= 0) return null;
  return numerator / denominator;
}

export function parseRange(value: string | string[] | undefined): RangeKey {
  return value === "7d" || value === "90d" || value === "custom" ? value : "30d";
}
