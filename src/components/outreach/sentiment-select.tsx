"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateEventSentiment } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import type { Sentiment } from "@/db/schema";

/** Classifying replies drives the positive-reply rate; unclassified replies never count as positive. */
export function SentimentSelect({ id, value }: { id: string; value: Sentiment | null }) {
  const { run, pending } = useAction();
  return (
    <Select value={value ?? "none"} disabled={pending} onValueChange={(v) => run(() => updateEventSentiment({ id, sentiment: v === "none" ? null : (v as Sentiment) }), { success: "Reply classified" })}>
      <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Reply classification">
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
  );
}
