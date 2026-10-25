"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { generateLab, saveLabDraft, type LabOutput } from "@/server/actions/ai-content";
import { patchVersion } from "@/server/actions/content";
import { LAB_MODES, type LabMode } from "@/lib/lab-modes";
import { PLATFORM_LABEL } from "@/lib/labels";
import type { ContentVersion, Platform } from "@/db/schema";

/**
 * Generates AI suggestions for one post version and lets the user edit and explicitly
 * apply or save them. Nothing is applied or published automatically.
 */
export function AIDraftsDialog({
  open,
  onOpenChange,
  mode,
  sourceVersion,
  targetPlatform,
  contentItemId,
  pillarName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: LabMode;
  sourceVersion: ContentVersion;
  targetPlatform: Platform;
  contentItemId: string;
  pillarName: string | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<(LabOutput & { generationId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function generate() {
    setError(null);
    startLoading(async () => {
      const res = await generateLab({
        mode,
        sourceVersionId: sourceVersion.id,
        targetPlatform,
        count: mode === "alt_ctas" ? 4 : 3,
      });
      if (res.ok) {
        setResult(res.data);
        setEdits({});
      } else setError(res.error);
    });
  }

  // Generate once when the dialog opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(generate, []);

  function apply(i: number) {
    const item = result!.items[i]!;
    const text = edits[i] ?? item.body;
    startSaving(async () => {
      const res =
        mode === "repurpose"
          ? await saveLabDraft({
              title: item.title,
              body: text,
              platform: targetPlatform,
              format: item.format,
              hookStyle: item.hook_style,
              pillarName,
              contentItemId,
              derivedFromVersionId: sourceVersion.id,
            })
          : mode === "alt_ctas"
            ? await patchVersion({ id: sourceVersion.id, cta: text })
            : await patchVersion({ id: sourceVersion.id, body: text });
      if (res.ok) {
        toast.success(mode === "repurpose" ? `Saved as a ${PLATFORM_LABEL[targetPlatform]} draft` : "Applied to the post");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const applyLabel = mode === "repurpose" ? `Save as ${PLATFORM_LABEL[targetPlatform]} draft` : mode === "alt_ctas" ? "Use this CTA" : "Replace post text";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> {LAB_MODES[mode]}
            {mode === "repurpose" && <Badge variant="outline">→ {PLATFORM_LABEL[targetPlatform]}</Badge>}
          </DialogTitle>
          <DialogDescription>AI suggestions based on your post and positioning. Edit freely — nothing changes until you apply it.</DialogDescription>
        </DialogHeader>
        {loading && (
          <div className="space-y-3" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Drafting… this can take a little while.</p>
          </div>
        )}
        {error && !loading && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Couldn't generate suggestions</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {result && !loading && (
          <div className="space-y-3">
            {result.warnings.length > 0 && (
              <Alert>
                <AlertTriangle />
                <AlertTitle>Check before using</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {result.items.map((item, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <Button size="xs" onClick={() => apply(i)} disabled={saving}>
                    {applyLabel}
                  </Button>
                </div>
                <Textarea
                  value={edits[i] ?? item.body}
                  onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                  rows={mode === "alt_ctas" ? 2 : 6}
                  aria-label={`Suggestion ${i + 1}`}
                />
                <p className="text-xs text-muted-foreground">{item.rationale}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
            <RefreshCw /> Regenerate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
