"use client";

import { fmtDateTime, fmtRelative } from "@/lib/format";

/**
 * Relative time ("3 days ago"). The server and browser render it at slightly different
 * moments, so the text is allowed to differ during hydration.
 */
export function TimeAgo({ date, className }: { date: Date | string | null | undefined; className?: string }) {
  if (!date) return <span className={className}>—</span>;
  const d = new Date(date);
  return (
    <time dateTime={d.toISOString()} title={fmtDateTime(d)} className={className} suppressHydrationWarning>
      {fmtRelative(d)}
    </time>
  );
}
