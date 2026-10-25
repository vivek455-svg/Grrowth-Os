"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, ClipboardCopy, FilePlus2, Lightbulb, Plug, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/app/empty-state";
import { generateLab, saveLabDraft, type LabOutput } from "@/server/actions/ai-content";
import { LAB_MODES, type LabMode } from "@/lib/lab-modes";
import { FORMAT_LABEL, HOOK_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import { toLocalInput } from "@/lib/format";
import type { ContentFormat, HookStyle, Platform } from "@/db/schema";
import { cn } from "@/lib/utils";

const GROUPS: { label: string; modes: LabMode[] }[] = [
  { label: "Ideas", modes: ["ideas_from_pillars", "ideas_from_performance", "project_angles", "content_series", "weekly_plan"] },
  { label: "Write", modes: ["linkedin_post", "x_post", "x_thread", "teardown_post", "lesson_post"] },
  { label: "Improve an existing post", modes: ["repurpose", "rewrite_hook", "improve_clarity", "alt_ctas"] },
];
const SOURCE_MODES: LabMode[] = ["repurpose", "rewrite_hook", "improve_clarity", "alt_ctas"];
const BRIEF_HINT: Partial<Record<LabMode, string>> = {
  project_angles: "Describe the project: client type (no names unless public), the problem, what you changed, and what you can share. Only facts.",
  teardown_post: "Paste your observations about the landing page: URL, what works, what's unclear, and what you'd change.",
  lesson_post: "Describe the design lesson and an example where you applied it.",
  linkedin_post: "What's the post about? Add specifics: an example, a mistake you see, a principle.",
  x_post: "What's the one idea?",
  x_thread: "What should the thread teach? Add the steps or points.",
};

type Item = LabOutput["items"][number];

function ItemCard({
  item,
  pillars,
  onReplace,
  defaultPlatform,
}: {
  item: Item;
  pillars: { id: string; name: string }[];
  onReplace: (next: Item) => void;
  defaultPlatform: Platform;
}) {
  const router = useRouter();
  const [body, setBody] = useState(item.body);
  const [platform, setPlatform] = useState<Platform>(item.platform ?? defaultPlatform);
  const [when, setWhen] = useState("");
  const [busy, start] = useTransition();
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const isIdea = !item.body.trim() || item.body.length < 200;

  function save(kind: "draft" | "idea" | "calendar") {
    start(async () => {
      const res = await saveLabDraft({
        title: item.title,
        body,
        platform,
        format: item.format,
        hookStyle: item.hook_style,
        pillarName: item.pillar && pillars.some((p) => p.name === item.pillar) ? item.pillar : null,
        asIdea: kind === "idea",
        plannedAt: kind === "calendar" && when ? new Date(when) : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (kind === "idea") toast.success("Saved to ideas");
      else
        toast.success(kind === "calendar" ? "Added to the calendar as a draft" : "Saved as a draft", {
          action: res.data.id ? { label: "Open", onClick: () => router.push(`/content/${res.data.id}`) } : undefined,
        });
    });
  }

  function rewriteSelection() {
    const s = sel;
    const passage = s && s.end > s.start ? body.slice(s.start, s.end) : null;
    start(async () => {
      const res = await generateLab({
        mode: "improve_clarity",
        sourceText: passage ?? body,
        brief: passage ? `Rewrite only this passage so it reads better in context. Full post for context:\n${body}` : "",
        targetPlatform: platform,
        count: 1,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const next = res.data.items[0]?.body;
      if (!next) return;
      if (passage && s) setBody(body.slice(0, s.start) + next + body.slice(s.end));
      else setBody(next);
      toast.success(passage ? "Selection rewritten" : "Post rewritten");
    });
  }

  return (
    <Card size="sm" className={cn("gap-3 transition-opacity", busy && "opacity-70")}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{item.title}</p>
          <div className="flex flex-wrap gap-1">
            {item.suggested_day && <Badge variant="secondary">{item.suggested_day}</Badge>}
            <Badge variant="outline" className="font-normal">{FORMAT_LABEL[item.format as ContentFormat]}</Badge>
            {item.hook_style && <Badge variant="outline" className="font-normal">{HOOK_LABEL[item.hook_style as HookStyle]} hook</Badge>}
            {item.pillar && <Badge variant="outline" className="font-normal">{item.pillar}</Badge>}
          </div>
        </div>
        <ToggleGroup type="single" size="sm" variant="outline" value={platform} onValueChange={(v) => v && setPlatform(v as Platform)} aria-label="Platform">
          <ToggleGroupItem value="linkedin">LinkedIn</ToggleGroupItem>
          <ToggleGroupItem value="x">X</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onSelect={(e) => setSel({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
          rows={isIdea ? 3 : 8}
          aria-label={`${item.title} text`}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{item.rationale}</span>
          <span className={cn("num shrink-0 pl-3", platform === "x" && item.format !== "thread" && body.length > 280 && "font-medium text-destructive")}>{body.length} chars</span>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          <Button size="xs" onClick={() => save("draft")} disabled={busy}>
            <FilePlus2 /> Save draft
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="xs" variant="outline" disabled={busy}>
                <CalendarPlus /> Add to calendar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2">
              <p className="text-sm font-medium">Plan for</p>
              <Input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} aria-label="Planned date" />
              <p className="text-xs text-muted-foreground">Saved as a draft on that date. It won't be published automatically.</p>
              <Button size="sm" className="w-full" disabled={!when || busy} onClick={() => save("calendar")}>
                Add
              </Button>
            </PopoverContent>
          </Popover>
          <Button size="xs" variant="outline" onClick={() => save("idea")} disabled={busy}>
            <Lightbulb /> Save idea
          </Button>
          <Button size="xs" variant="ghost" onClick={rewriteSelection} disabled={busy || !body.trim()} title="Select text first to rewrite only that part">
            <WandSparkles /> Rewrite {sel && sel.end > sel.start ? "selection" : "post"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(body);
              toast.success("Copied");
            }}
          >
            <ClipboardCopy /> Copy
          </Button>
          <Button size="xs" variant="ghost" className="ml-auto" disabled={busy} onClick={() => onReplace(item)}>
            <RefreshCw /> Regenerate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContentLab({
  aiEnabled,
  pillars,
  sources,
  initialFormat,
}: {
  aiEnabled: boolean;
  pillars: { id: string; name: string }[];
  sources: { id: string; title: string; platform: Platform; status: string }[];
  initialFormat: ContentFormat | null;
}) {
  const [mode, setMode] = useState<LabMode>(initialFormat ? "ideas_from_pillars" : "ideas_from_performance");
  const [pillarIds, setPillarIds] = useState<string[]>([]);
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [format, setFormat] = useState<string>(initialFormat ?? "any");
  const [count, setCount] = useState("3");
  const [sourceId, setSourceId] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [result, setResult] = useState<(LabOutput & { generationId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [round, setRound] = useState(0);

  if (!aiEnabled)
    return (
      <EmptyState
        icon={Plug}
        title="Connect an AI provider to use the Content Lab"
        description="The Lab drafts posts from your positioning, pillars and real performance data. Add an API key on the Integrations page. Everything else in the app works without it."
      >
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link href="/integrations">Open Integrations</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/content/library?tab=ideas">Browse saved ideas</Link>
          </Button>
        </div>
      </EmptyState>
    );

  const needsSource = SOURCE_MODES.includes(mode);
  const targetPlatform: Platform = mode === "x_post" || mode === "x_thread" ? "x" : mode === "linkedin_post" ? "linkedin" : platform;

  function run(replaceIndex?: number) {
    setError(null);
    start(async () => {
      const res = await generateLab({
        mode,
        pillarIds,
        brief,
        sourceVersionId: needsSource ? sourceId || null : null,
        targetPlatform,
        format: format === "any" ? null : (format as ContentFormat),
        count: replaceIndex !== undefined ? 1 : Number(count),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (replaceIndex !== undefined && result) {
        const items = [...result.items];
        items[replaceIndex] = res.data.items[0] ?? items[replaceIndex]!;
        setResult({ ...result, items, warnings: [...new Set([...result.warnings, ...res.data.warnings])] });
      } else setResult(res.data);
      setRound((r) => r + 1);
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit lg:sticky lg:top-16">
        <CardHeader>
          <CardTitle>What do you need?</CardTitle>
          <CardDescription>Uses your positioning, pillars, and top posts as reference. Output is always a draft.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>Task</FieldLabel>
              <Select value={mode} onValueChange={(v) => setMode(v as LabMode)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUPS.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.modes.map((m) => (
                        <SelectItem key={m} value={m}>{LAB_MODES[m]}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {needsSource && (
              <Field>
                <FieldLabel>Source post</FieldLabel>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a post" /></SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {PLATFORM_LABEL[s.platform]} · {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {!["x_post", "x_thread", "linkedin_post"].includes(mode) && (
              <Field>
                <FieldLabel>{mode === "repurpose" ? "Adapt for" : "Platform"}</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={platform} onValueChange={(v) => v && setPlatform(v as Platform)} className="w-full">
                  <ToggleGroupItem value="linkedin" className="flex-1">LinkedIn</ToggleGroupItem>
                  <ToggleGroupItem value="x" className="flex-1">X</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            )}
            {!needsSource && pillars.length > 0 && (
              <Field>
                <FieldLabel>Pillars</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {pillars.map((p) => {
                    const on = pillarIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPillarIds(on ? pillarIds.filter((x) => x !== p.id) : [...pillarIds, p.id])}
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                          on ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                <FieldDescription>Leave empty to use all pillars.</FieldDescription>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Format</FieldLabel>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {Object.entries(FORMAT_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>How many</FieldLabel>
                <Select value={count} onValueChange={setCount} disabled={mode === "improve_clarity"}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["1", "3", "5", "7"].map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="lab-brief">Material & direction</FieldLabel>
              <Textarea id="lab-brief" rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={BRIEF_HINT[mode] ?? "Optional: angle, constraints, things to include or avoid."} />
              <FieldDescription>Facts you provide are the only facts the AI may use.</FieldDescription>
            </Field>
            <Button onClick={() => run()} disabled={loading || (needsSource && !sourceId)}>
              <Sparkles /> {loading ? "Generating…" : "Generate"}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-3" aria-live="polite">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Generation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading && !result && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} size="sm" className="gap-3 px-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-24 w-full" />
              </Card>
            ))}
          </div>
        )}
        {!loading && !result && !error && (
          <EmptyState
            icon={Sparkles}
            title="Pick a task and generate"
            description="Try “Ideas from what performed” to build on posts that already resonated, or paste observations into “Landing page teardown → post”."
          />
        )}
        {result && (
          <>
            {result.warnings.length > 0 && (
              <Alert>
                <AlertTriangle />
                <AlertTitle>Review before using</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
              {result.items.map((item, i) => (
                <ItemCard key={`${round}-${i}`} item={item} pillars={pillars} defaultPlatform={targetPlatform} onReplace={() => run(i)} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">AI drafts can be wrong. Check every claim before posting — nothing here is published automatically.</p>
          </>
        )}
      </div>
    </div>
  );
}
