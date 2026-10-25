"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { markPublished, recordMetrics } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import { toLocalInput } from "@/lib/format";
import type { Platform } from "@/db/schema";

/**
 * Manual publication record. The app never marks a post as published on its own: this is
 * the user confirming they published it (or the platform API confirming it).
 */
export function MarkPublishedDialog({
  versionId,
  platform,
  open,
  onOpenChange,
}: {
  versionId: string;
  platform: Platform;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [when, setWhen] = useState(toLocalInput(new Date()));
  const [url, setUrl] = useState("");
  const [postId, setPostId] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record publication</DialogTitle>
          <DialogDescription>
            Confirm you published this on {platform === "x" ? "X" : "LinkedIn"}. It will be labelled as manually recorded.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="mp-when">Published at</FieldLabel>
            <Input id="mp-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mp-url">Post URL</FieldLabel>
            <Input id="mp-url" placeholder={platform === "x" ? "https://x.com/you/status/…" : "https://www.linkedin.com/feed/update/…"} value={url} onChange={(e) => setUrl(e.target.value)} />
            <FieldDescription>Optional, but needed to open the post later and to match API metrics.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mp-id">Platform post ID</FieldLabel>
            <Input id="mp-id" value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="Optional" />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || !when}
            onClick={() =>
              run(() => markPublished({ id: versionId, publishedAt: new Date(when), platformPostUrl: url, platformPostId: postId || null }), {
                success: "Publication recorded",
                onSuccess: () => {
                  onOpenChange(false);
                  router.refresh();
                },
              })
            }
          >
            {pending && <Spinner />} Mark as published
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const METRICS = [
  ["impressions", "Impressions"],
  ["likes", "Likes / reactions"],
  ["replies", "Replies / comments"],
  ["reposts", "Reposts / shares"],
  ["bookmarks", "Bookmarks"],
  ["linkClicks", "Link clicks"],
  ["profileVisits", "Profile visits"],
  ["meaningfulReplies", "Meaningful replies"],
] as const;

export function RecordMetricsDialog({
  versionId,
  platform,
  open,
  onOpenChange,
}: {
  versionId: string;
  platform: Platform;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [capturedAt, setCapturedAt] = useState(toLocalInput(new Date()));
  const [source, setSource] = useState<"manual" | "estimated">("manual");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record metrics snapshot</DialogTitle>
          <DialogDescription>
            Copy the numbers from {platform === "x" ? "X" : "LinkedIn"} analytics. Leave a field empty if the platform doesn't show it — empty is stored as “not available”, never zero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {METRICS.map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`rm-${key}`}>{label}</FieldLabel>
              <Input
                id={`rm-${key}`}
                inputMode="numeric"
                type="number"
                min={0}
                value={values[key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="rm-at">Captured at</FieldLabel>
            <Input id="rm-at" type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Source</FieldLabel>
            <Select value={source} onValueChange={(v) => setSource(v as "manual" | "estimated")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Copied from platform</SelectItem>
                <SelectItem value="estimated">Estimate (labelled)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">“Meaningful replies” are replies from people in your target audience or with a substantive question — your judgement.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => recordMetrics({ versionId, capturedAt: new Date(capturedAt), source, ...values }), {
                success: "Metrics recorded",
                onSuccess: () => {
                  onOpenChange(false);
                  setValues({});
                  router.refresh();
                },
              })
            }
          >
            {pending && <Spinner />} Save snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
