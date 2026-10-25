"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  ClipboardCopy,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Plus,
  Repeat2,
  Send,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ContentStatusBadge, MetricSourceBadge, PlatformBadge } from "@/components/app/badges";
import { MarkPublishedDialog, RecordMetricsDialog } from "./publish-dialogs";
import { AIDraftsDialog } from "./ai-drafts-dialog";
import {
  addVersion,
  archiveContent,
  deleteContent,
  deleteVersion,
  duplicateContent,
  saveVersion,
  unpublish,
  updateContentItem,
} from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import { engagementRate, engagements } from "@/lib/metrics/content";
import { fmtDateTime, fmtNumber, fmtPercent, toLocalInput } from "@/lib/format";
import { CTA_TYPE_LABEL, FORMAT_LABEL, GOAL_LABEL, HOOK_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import type { ContentItem, ContentVersion, MetricsSnapshot, Platform } from "@/db/schema";
import type { LabMode } from "@/lib/lab-modes";
import { cn } from "@/lib/utils";

const LIMITS: Record<Platform, number> = { x: 280, linkedin: 3000 };

function composeUrl(platform: Platform, body: string) {
  return platform === "x" ? `https://x.com/intent/tweet?text=${encodeURIComponent(body)}` : "https://www.linkedin.com/feed/";
}

function VersionPanel({
  version,
  snapshots,
  aiEnabled,
  onAI,
}: {
  version: ContentVersion;
  snapshots: MetricsSnapshot[];
  aiEnabled: boolean;
  onAI: (mode: LabMode, v: ContentVersion, target?: Platform) => void;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [v, setV] = useState({
    body: version.body,
    format: version.format,
    hookStyle: version.hookStyle ?? "none",
    ctaType: version.ctaType ?? "none_set",
    cta: version.cta ?? "",
    status: version.status === "published" ? "published" : version.status,
    plannedAt: toLocalInput(version.plannedAt),
  });
  const [publishOpen, setPublishOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const dirty =
    v.body !== version.body ||
    v.format !== version.format ||
    v.hookStyle !== (version.hookStyle ?? "none") ||
    v.ctaType !== (version.ctaType ?? "none_set") ||
    v.cta !== (version.cta ?? "") ||
    (version.status !== "published" && v.status !== version.status) ||
    v.plannedAt !== toLocalInput(version.plannedAt);
  const published = version.status === "published";
  const limit = LIMITS[version.platform];
  // Threads are checked per post (posts separated by blank lines).
  const isThread = v.format === "thread" && version.platform === "x";
  const measured = isThread ? Math.max(0, ...v.body.split(/\n\s*\n/).map((p) => p.trim().length)) : v.body.length;
  const over = measured > limit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function save() {
    run(
      () =>
        saveVersion({
          id: version.id,
          body: v.body,
          format: v.format,
          hookStyle: v.hookStyle === "none" ? null : (v.hookStyle as ContentVersion["hookStyle"]),
          ctaType: v.ctaType === "none_set" ? null : (v.ctaType as ContentVersion["ctaType"]),
          cta: v.cta,
          // Published versions keep their status server-side; only metadata changes are saved.
          status: published ? "draft" : (v.status as "draft"),
          plannedAt: v.plannedAt ? new Date(v.plannedAt) : null,
        }),
      { success: "Saved", onSuccess: () => router.refresh() },
    );
  }

  const sorted = [...snapshots].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const latest = sorted[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlatformBadge platform={version.platform} />
            <ContentStatusBadge status={version.status} />
            {version.derivedFromVersionId && <Badge variant="outline" className="font-normal">Repurposed</Badge>}
          </CardTitle>
          <CardAction className="flex items-center gap-1">
            {aiEnabled && !published && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Sparkles /> AI assist
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Results open as drafts to review</DropdownMenuLabel>
                  <DropdownMenuItem disabled={!v.body.trim()} onSelect={() => onAI("rewrite_hook", { ...version, body: v.body })}>Rewrite hook</DropdownMenuItem>
                  <DropdownMenuItem disabled={!v.body.trim()} onSelect={() => onAI("improve_clarity", { ...version, body: v.body })}>Improve clarity</DropdownMenuItem>
                  <DropdownMenuItem disabled={!v.body.trim()} onSelect={() => onAI("alt_ctas", { ...version, body: v.body })}>Alternative CTAs</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <VersionMenu version={version} />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Textarea
              value={v.body}
              onChange={(e) => setV({ ...v, body: e.target.value })}
              rows={12}
              className="min-h-60 font-[450] leading-relaxed"
              placeholder={version.platform === "x" ? "What's the one idea?" : "Write the post…"}
              aria-label={`${PLATFORM_LABEL[version.platform]} post text`}
              readOnly={published}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{published ? "Published text is locked. Duplicate the post to reuse it." : "⌘/Ctrl + S to save"}</span>
              <span className={cn("num", over && "font-medium text-destructive")}>
                {isThread ? `Longest post ${measured}` : v.body.length} / {limit}
              </span>
            </div>
          </div>
          <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel>Format</FieldLabel>
              <Select value={v.format} onValueChange={(x) => setV({ ...v, format: x as typeof v.format })} disabled={published}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMAT_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Hook style</FieldLabel>
              <Select value={v.hookStyle} onValueChange={(x) => setV({ ...v, hookStyle: x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {Object.entries(HOOK_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>CTA type</FieldLabel>
              <Select value={v.ctaType} onValueChange={(x) => setV({ ...v, ctaType: x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none_set">Not set</SelectItem>
                  {Object.entries(CTA_TYPE_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {!published && (
              <>
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={v.status} onValueChange={(x) => setV({ ...v, status: x as typeof v.status })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idea">Idea</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="ready">Ready</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`planned-${version.id}`}>Planned for</FieldLabel>
                  <Input id={`planned-${version.id}`} type="datetime-local" value={v.plannedAt} onChange={(e) => setV({ ...v, plannedAt: e.target.value })} />
                </Field>
              </>
            )}
            <Field className={published ? "" : "lg:col-span-1"}>
              <FieldLabel htmlFor={`cta-${version.id}`}>CTA text</FieldLabel>
              <Input id={`cta-${version.id}`} value={v.cta} onChange={(e) => setV({ ...v, cta: e.target.value })} placeholder="Optional" />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
            <Button onClick={save} disabled={pending || !dirty} size="sm">
              {pending && <Spinner />} Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publishing</CardTitle>
          <CardDescription>
            {published
              ? `Published ${fmtDateTime(version.publishedAt)} · ${version.publishSource === "api" ? "confirmed by the platform API" : "recorded manually"}`
              : "Native scheduling needs a connected account with publishing permission. Until then: copy, post on the platform, then record it here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {published ? (
            <>
              {version.platformPostUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={version.platformPostUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open post
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setMetricsOpen(true)}>
                <BarChart3 /> Record metrics
              </Button>
              {version.publishSource === "manual" && (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => unpublish({ id: version.id }), { success: "Publication record removed", onSuccess: () => router.refresh() })}>
                  <Undo2 /> Undo publication record
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!v.body.trim()}
                onClick={async () => {
                  await navigator.clipboard.writeText(v.body);
                  toast.success("Copied to clipboard");
                }}
              >
                <ClipboardCopy /> Copy text
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={composeUrl(version.platform, v.body)} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open {PLATFORM_LABEL[version.platform]} composer
                </a>
              </Button>
              <Button size="sm" onClick={() => setPublishOpen(true)} disabled={!v.body.trim() || dirty}>
                <Send /> I published it
              </Button>
              {dirty && <span className="self-center text-xs text-muted-foreground">Save first</span>}
            </>
          )}
        </CardContent>
      </Card>

      {published && (
        <Card id="performance">
          <CardHeader>
            <CardTitle>Performance history</CardTitle>
            <CardDescription>Each snapshot is kept, so you can see how numbers changed. Empty cells were not available.</CardDescription>
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => setMetricsOpen(true)}>
                <Plus /> Snapshot
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {sorted.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No metrics recorded yet.</p>
            ) : (
              <>
                {latest && (
                  <div className="grid grid-cols-3 gap-3 px-4 pb-4 sm:grid-cols-5">
                    {[
                      ["Impressions", fmtNumber(latest.impressions)],
                      ["Engagements", fmtNumber(engagements(latest))],
                      ["Engagement rate", fmtPercent(engagementRate(latest, { denominator: "impressions" }))],
                      ["Profile visits", fmtNumber(latest.profileVisits)],
                      ["Link clicks", fmtNumber(latest.linkClicks)],
                    ].map(([l, val]) => (
                      <div key={l}>
                        <p className="text-xs text-muted-foreground">{l}</p>
                        <p className="num text-base font-semibold">{val}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Captured</TableHead>
                      <TableHead className="text-right">Impr.</TableHead>
                      <TableHead className="text-right">Likes</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead className="text-right">Reposts</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="pr-4">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="num pl-4 text-muted-foreground">{fmtDateTime(s.capturedAt)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.impressions)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.likes)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.replies)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.reposts)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.linkClicks)}</TableCell>
                        <TableCell className="num text-right">{fmtNumber(s.profileVisits)}</TableCell>
                        <TableCell className="pr-4"><MetricSourceBadge source={s.source} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {publishOpen && <MarkPublishedDialog versionId={version.id} platform={version.platform} open onOpenChange={setPublishOpen} />}
      {metricsOpen && <RecordMetricsDialog versionId={version.id} platform={version.platform} open onOpenChange={setMetricsOpen} />}
    </div>
  );
}

function VersionMenu({ version }: { version: ContentVersion }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Version actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => run(() => deleteVersion({ id: version.id }), { success: "Version deleted", onSuccess: () => router.refresh() })}
        >
          <Trash2 /> Delete this version
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ContentEditor({
  item,
  versions,
  snapshots,
  tags,
  pillars,
  campaigns,
  linkedOpps,
  aiEnabled,
}: {
  item: ContentItem;
  versions: ContentVersion[];
  snapshots: MetricsSnapshot[];
  tags: string[];
  pillars: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  linkedOpps: { id: string; name: string; stage: string }[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { pending, run } = useAction();
  const [tab, setTab] = useState(params.get("v") ?? versions[0]?.id ?? "");
  const [details, setDetails] = useState({
    title: item.title,
    pillarId: item.pillarId ?? "none",
    topic: item.topic ?? "",
    keywords: item.keywords.join(", "),
    tags: tags.join(", "),
    audience: item.audience ?? "",
    goal: item.goal ?? "none",
    campaignId: item.campaignId ?? "none",
    relatedUrl: item.relatedUrl ?? "",
    notes: item.notes ?? "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ai, setAI] = useState<{ mode: LabMode; version: ContentVersion; target?: Platform } | null>(null);
  const platforms = useMemo(() => new Set(versions.map((v) => v.platform)), [versions]);

  // ?repurpose=x&from=<versionId>: open the repurpose flow from recommendations / library.
  useEffect(() => {
    const target = params.get("repurpose") as Platform | null;
    const from = versions.find((v) => v.id === params.get("from")) ?? versions[0];
    if (target && from && !platforms.has(target)) {
      if (aiEnabled) setAI({ mode: "repurpose", version: from, target });
      else
        run(() => addVersion({ contentItemId: item.id, platform: target, derivedFromVersionId: from.id }), {
          success: `${PLATFORM_LABEL[target]} version created from the original — edit it to fit the platform.`,
          onSuccess: (d) => {
            setTab(d.id);
            router.replace(`/content/${item.id}?v=${d.id}`);
          },
        });
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDetails() {
    run(
      () =>
        updateContentItem({
          id: item.id,
          title: details.title,
          pillarId: details.pillarId === "none" ? null : details.pillarId,
          topic: details.topic,
          keywords: details.keywords.split(",").map((s) => s.trim()).filter(Boolean),
          tags: details.tags.split(",").map((s) => s.trim()).filter(Boolean),
          audience: details.audience,
          goal: details.goal === "none" ? null : (details.goal as ContentItem["goal"]),
          campaignId: details.campaignId === "none" ? null : details.campaignId,
          relatedUrl: details.relatedUrl,
          notes: details.notes,
        }),
      { success: "Details saved", onSuccess: () => router.refresh() },
    );
  }

  const missing = (["linkedin", "x"] as const).filter((p) => !platforms.has(p));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="xs" className="-ml-2 mb-1 text-muted-foreground">
            <Link href="/content/library">
              <ArrowLeft /> Library
            </Link>
          </Button>
          <h1 className="truncate text-xl font-semibold tracking-tight">{item.title}</h1>
          <p className="text-sm text-muted-foreground">
            One idea, {versions.length} platform version{versions.length === 1 ? "" : "s"}
            {item.archivedAt ? " · archived" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {missing.map((p) => (
            <DropdownMenu key={p}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Repeat2 /> Add {PLATFORM_LABEL[p]} version
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {aiEnabled && versions[0] && (
                  <DropdownMenuItem onSelect={() => setAI({ mode: "repurpose", version: versions.find((v) => v.body.trim()) ?? versions[0]!, target: p })}>
                    <Sparkles /> Adapt with AI (review before saving)
                  </DropdownMenuItem>
                )}
                {versions[0] && (
                  <DropdownMenuItem
                    onSelect={() =>
                      run(() => addVersion({ contentItemId: item.id, platform: p, derivedFromVersionId: versions[0]!.id }), {
                        success: "Version created",
                        onSuccess: (d) => {
                          setTab(d.id);
                          router.refresh();
                        },
                      })
                    }
                  >
                    <Copy /> Copy text from {PLATFORM_LABEL[versions[0].platform]} version
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() =>
                    run(() => addVersion({ contentItemId: item.id, platform: p, body: "" }), {
                      success: "Version created",
                      onSuccess: (d) => {
                        setTab(d.id);
                        router.refresh();
                      },
                    })
                  }
                >
                  <Plus /> Start blank
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Post actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => run(() => duplicateContent({ id: item.id }), { success: "Duplicated", onSuccess: (d) => router.push(`/content/${d.id}`) })}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => archiveContent({ id: item.id, archived: !item.archivedAt }), { success: item.archivedAt ? "Restored" : "Archived", onSuccess: () => router.refresh() })}>
                <Archive /> {item.archivedAt ? "Restore" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Delete permanently
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {versions.length === 0 ? (
            <Alert>
              <AlertDescription>This idea has no platform versions yet. Add one above.</AlertDescription>
            </Alert>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {versions.map((v) => (
                  <TabsTrigger key={v.id} value={v.id}>
                    {PLATFORM_LABEL[v.platform]}
                    <span className={cn("ml-1 size-1.5 rounded-full", v.status === "published" ? "bg-success" : v.status === "scheduled" ? "bg-warning" : "bg-muted-foreground/40")} aria-hidden />
                  </TabsTrigger>
                ))}
              </TabsList>
              {versions.map((v) => (
                <TabsContent key={v.id} value={v.id} className="mt-3">
                  <VersionPanel key={`${v.id}-${v.updatedAt.getTime()}`} version={v} snapshots={snapshots.filter((s) => s.versionId === v.id)} aiEnabled={aiEnabled} onAI={(mode, version, target) => setAI({ mode, version, target })} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Shared by every platform version.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel htmlFor="d-title">Internal label</FieldLabel>
                  <Input id="d-title" value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>Content pillar</FieldLabel>
                  <Select value={details.pillarId} onValueChange={(x) => setDetails({ ...details, pillarId: x })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No pillar</SelectItem>
                      {pillars.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Goal</FieldLabel>
                  <Select value={details.goal} onValueChange={(x) => setDetails({ ...details, goal: x })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {Object.entries(GOAL_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-topic">Topic</FieldLabel>
                  <Input id="d-topic" value={details.topic} onChange={(e) => setDetails({ ...details, topic: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-kw">Keywords</FieldLabel>
                  <Input id="d-kw" value={details.keywords} onChange={(e) => setDetails({ ...details, keywords: e.target.value })} placeholder="Comma separated" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-tags">Tags</FieldLabel>
                  <Input id="d-tags" value={details.tags} onChange={(e) => setDetails({ ...details, tags: e.target.value })} placeholder="Comma separated" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-aud">Intended audience</FieldLabel>
                  <Input id="d-aud" value={details.audience} onChange={(e) => setDetails({ ...details, audience: e.target.value })} />
                </Field>
                {campaigns.length > 0 && (
                  <Field>
                    <FieldLabel>Content campaign</FieldLabel>
                    <Select value={details.campaignId} onValueChange={(x) => setDetails({ ...details, campaignId: x })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {campaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="d-url">Related design / project URL</FieldLabel>
                  <Input id="d-url" value={details.relatedUrl} onChange={(e) => setDetails({ ...details, relatedUrl: e.target.value })} placeholder="https://" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-notes">Notes</FieldLabel>
                  <Textarea id="d-notes" rows={3} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
                </Field>
                <Button size="sm" onClick={saveDetails} disabled={pending}>
                  {pending && <Spinner />} Save details
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Linked opportunities</CardTitle>
              <CardDescription>Attribution you recorded — not proof of causation.</CardDescription>
            </CardHeader>
            <CardContent>
              {linkedOpps.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet. Link this post from an opportunity's touchpoints.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {linkedOpps.map((o) => (
                    <li key={o.id}>
                      <Link href={`/opportunities?open=${o.id}`} className="hover:underline">{o.name}</Link>
                      <span className="ml-1 text-xs text-muted-foreground">· {o.stage}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <div className="space-y-1 text-xs text-muted-foreground">
            <Label className="text-xs font-normal">Created {fmtDateTime(item.createdAt)}</Label>
            <FieldDescription className="text-xs">Updated {fmtDateTime(item.updatedAt)}</FieldDescription>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every platform version and its metrics history. Archive instead if you might want the data later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => run(() => deleteContent({ id: item.id }), { success: "Post deleted", onSuccess: () => router.push("/content/library") })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ai && (
        <AIDraftsDialog
          open
          onOpenChange={(o) => !o && setAI(null)}
          mode={ai.mode}
          sourceVersion={ai.version}
          targetPlatform={ai.target ?? ai.version.platform}
          contentItemId={item.id}
          pillarName={pillars.find((p) => p.id === item.pillarId)?.name ?? null}
        />
      )}
    </div>
  );
}
