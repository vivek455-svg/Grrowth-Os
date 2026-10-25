"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, ExternalLink, Globe, Plus, Sparkles, Trash2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/app/empty-state";
import { deleteResearch, runResearch, saveResearch } from "@/server/actions/ai-outreach";
import { useAction } from "@/hooks/use-action";
import { fmtDateTime } from "@/lib/format";
import type { ResearchObservation, prospectResearch } from "@/db/schema";
import { cn } from "@/lib/utils";

type Research = typeof prospectResearch.$inferSelect;

function ResearchEditor({ prospectId, research, onDone }: { prospectId: string; research: Research | null; onDone: () => void }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [v, setV] = useState({
    url: research?.url ?? "",
    whatTheyDo: research?.whatTheyDo ?? "",
    targetAudience: research?.targetAudience ?? "",
    valueProposition: research?.valueProposition ?? "",
    offerings: research?.offerings ?? "",
    primaryCta: research?.primaryCta ?? "",
  });
  const [obs, setObs] = useState<ResearchObservation[]>(research?.observations ?? []);
  const field = (k: keyof typeof v, label: string, area = false) => (
    <Field>
      <FieldLabel htmlFor={`re-${k}`}>{label}</FieldLabel>
      {area ? (
        <Textarea id={`re-${k}`} rows={2} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      ) : (
        <Input id={`re-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <div className="space-y-4">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {field("url", "Source URL")}
        {field("primaryCta", "Primary CTA")}
        {field("whatTheyDo", "What they do", true)}
        {field("targetAudience", "Target audience", true)}
        {field("valueProposition", "Value proposition", true)}
        {field("offerings", "Products / services", true)}
      </FieldGroup>
      <div className="space-y-2">
        <p className="text-sm font-medium">Observations</p>
        <p className="text-xs text-muted-foreground">Mark something verified only if you can point to it on the page. Everything else is a hypothesis and will be phrased as a question in outreach.</p>
        {obs.map((o, i) => (
          <div key={i} className="flex items-start gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className={cn("w-24 shrink-0", o.kind === "verified" ? "text-success" : "text-muted-foreground")}
              onClick={() => setObs(obs.map((x, j) => (j === i ? { ...x, kind: x.kind === "verified" ? "hypothesis" : "verified" } : x)))}
              aria-label={`Toggle verified for observation ${i + 1}`}
            >
              {o.kind === "verified" ? "Verified" : "Hypothesis"}
            </Button>
            <Textarea rows={1} className="min-h-8" value={o.text} onChange={(e) => setObs(obs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`Observation ${i + 1}`} />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setObs(obs.filter((_, j) => j !== i))} aria-label="Remove observation">
              <XIcon />
            </Button>
          </div>
        ))}
        <Button type="button" size="xs" variant="outline" onClick={() => setObs([...obs, { text: "", kind: "hypothesis", source_url: null }])}>
          <Plus /> Add observation
        </Button>
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                saveResearch({
                  id: research?.id,
                  prospectId,
                  ...v,
                  observations: obs.filter((o) => o.text.trim()).map((o) => ({ ...o, source_url: o.kind === "verified" ? (o.source_url ?? (v.url || null)) : null })),
                  reviewed: true,
                }),
              {
                success: "Research saved and marked reviewed",
                onSuccess: () => {
                  onDone();
                  router.refresh();
                },
              },
            )
          }
        >
          {pending && <Spinner />} Save as reviewed
        </Button>
      </div>
    </div>
  );
}

export function ResearchPanel({ prospectId, research, defaultUrl, aiEnabled }: { prospectId: string; research: Research[]; defaultUrl: string | null; aiEnabled: boolean }) {
  const router = useRouter();
  const { run } = useAction();
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, start] = useTransition();
  const latest = research[0];

  function research_() {
    start(async () => {
      const res = await runResearch({ prospectId, url: url || undefined });
      if (res.ok) {
        toast.success(res.data.ai ? "Research drafted — review it before using in outreach" : "Page extracted — add your observations and review");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Research a website</CardTitle>
          <CardDescription>
            Fetches one public page (robots.txt respected) and extracts what's on it{aiEnabled ? ", then drafts a summary separating verified facts from hypotheses" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <InputGroup>
            <InputGroupAddon>
              <Globe />
            </InputGroupAddon>
            <InputGroupInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.com" aria-label="Website URL" />
          </InputGroup>
          <Button onClick={research_} disabled={busy || !url.trim()} className="shrink-0">
            {busy ? <Spinner /> : aiEnabled ? <Sparkles /> : <Globe />} {busy ? "Researching…" : "Research"}
          </Button>
          <Button variant="outline" className="shrink-0" onClick={() => setEditing("new")}>
            <Plus /> Add manually
          </Button>
        </CardContent>
      </Card>

      {editing === "new" && (
        <Card>
          <CardContent>
            <ResearchEditor prospectId={prospectId} research={null} onDone={() => setEditing(null)} />
          </CardContent>
        </Card>
      )}

      {research.length === 0 && editing !== "new" && (
        <EmptyState icon={Globe} title="No research yet" description="Research before reaching out: personalised messages need at least one verified observation." />
      )}

      {research.map((r) => (
        <Card key={r.id} className={cn(r.id !== latest?.id && "opacity-80")}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {r.reviewStatus === "reviewed" ? (
                <Badge variant="secondary" className="gap-1 text-success"><CheckCircle2 className="size-3" /> Reviewed</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-dashed"><CircleDashed className="size-3" /> Draft — review before use</Badge>
              )}
              <Badge variant="outline" className="font-normal">{r.generatedBy === "ai" ? "AI summary + extraction" : r.generatedBy === "extraction" ? "Extracted" : "Manual"}</Badge>
              {r.id === latest?.id && <Badge variant="outline" className="font-normal">Latest</Badge>}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  {r.url} <ExternalLink className="size-3" />
                </a>
              )}
              <span>· {fmtDateTime(r.fetchedAt ?? r.createdAt)}</span>
            </CardDescription>
            <CardAction className="flex gap-1">
              <Button size="xs" variant="outline" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                {editing === r.id ? "Close" : r.reviewStatus === "reviewed" ? "Edit" : "Review & edit"}
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label="Delete research" onClick={() => run(() => deleteResearch({ id: r.id }), { success: "Research deleted", onSuccess: () => router.refresh() })}>
                <Trash2 />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {editing === r.id ? (
              <ResearchEditor prospectId={prospectId} research={r} onDone={() => setEditing(null)} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <dl className="space-y-2 text-sm">
                  {[
                    ["What they do", r.whatTheyDo],
                    ["Audience", r.targetAudience],
                    ["Value proposition", r.valueProposition],
                    ["Offerings", r.offerings],
                    ["Primary CTA", r.primaryCta],
                  ].map(([k, val]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd>{val || <span className="text-muted-foreground">—</span>}</dd>
                    </div>
                  ))}
                  {r.trustSignals.length > 0 && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Visible trust signals</dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {r.trustSignals.map((t) => (
                          <Badge key={t} variant="outline" className="font-normal">{t}</Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  {r.keySections.length > 0 && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Page sections (headings)</dt>
                      <dd className="text-muted-foreground">{r.keySections.join(" · ")}</dd>
                    </div>
                  )}
                </dl>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Observations</p>
                  {r.observations.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
                  <ul className="space-y-2">
                    {r.observations.map((o, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Badge variant={o.kind === "verified" ? "secondary" : "outline"} className={cn("h-fit shrink-0 font-normal", o.kind === "verified" ? "text-success" : "border-dashed")}>
                          {o.kind === "verified" ? "Verified" : "Hypothesis"}
                        </Badge>
                        <span>{o.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
