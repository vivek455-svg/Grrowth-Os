"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, ExternalLink, Search, Sparkles, UserPlus, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/app/empty-state";
import { addCandidate, planDiscovery, reviewCandidate, runDiscovery } from "@/server/actions/discovery";
import type { DiscoveryConfig } from "@/lib/domain/discovery";
import { useAction } from "@/hooks/use-action";
import { hostname } from "@/lib/format";
import type { prospectSources } from "@/db/schema";

type Candidate = typeof prospectSources.$inferSelect;

const EMPTY: DiscoveryConfig = {
  companyType: "",
  industry: "",
  geography: "",
  companySize: "",
  decisionMakerRole: "",
  serviceRelevance: "",
  requiredEvidence: "",
  source: "search_api",
  maxResults: 15,
  searchQueries: [""],
};

const EXAMPLES = [
  "Find early-stage B2B SaaS companies with unclear landing page messaging and identify founders or marketing leaders.",
  "Find design agencies that use Framer or may need additional Framer development support.",
];

function AddDialog({ c, campaigns, onDone }: { c: Candidate; campaigns: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [v, setV] = useState({ fullName: c.candidateName ?? "", jobTitle: c.candidateTitle ?? "", linkedinUrl: "", company: c.candidateCompany ?? "", campaignId: "none" });
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to CRM</DialogTitle>
          <DialogDescription>
            Add the decision-maker you found on their site or public profile. We don't guess names or emails — check the About or Team page.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="ac-name">Person's name</FieldLabel>
            <Input id="ac-name" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ac-title">Job title</FieldLabel>
            <Input id="ac-title" value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ac-company">Company</FieldLabel>
            <Input id="ac-company" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ac-li">LinkedIn URL (optional)</FieldLabel>
            <Input id="ac-li" value={v.linkedinUrl} onChange={(e) => setV({ ...v, linkedinUrl: e.target.value })} placeholder="https://www.linkedin.com/in/…" />
          </Field>
          {campaigns.length > 0 && (
            <Field>
              <FieldLabel>Assign to campaign</FieldLabel>
              <Select value={v.campaignId} onValueChange={(x) => setV({ ...v, campaignId: x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No campaign</SelectItem>
                  {campaigns.map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>Cancel</Button>
          <Button
            disabled={pending || !v.fullName.trim()}
            onClick={() =>
              run(() => addCandidate({ id: c.id, ...v, campaignId: v.campaignId === "none" ? null : v.campaignId }), {
                success: "Added to prospects",
                onSuccess: (d) => {
                  onDone();
                  toast.success("Added", { action: { label: "Research now", onClick: () => router.push(`/prospects/${d.id}`) } });
                },
              })
            }
          >
            {pending && <Spinner />} Add prospect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DiscoveryView({
  aiEnabled,
  searchEnabled,
  candidates,
  runs,
  campaigns,
}: {
  aiEnabled: boolean;
  searchEnabled: boolean;
  candidates: Candidate[];
  runs: { id: string; query: string; status: string; error: string | null; createdAt: Date }[];
  campaigns: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [query, setQuery] = useState("");
  const [config, setConfig] = useState<DiscoveryConfig | null>(null);
  const [planning, startPlan] = useTransition();
  const [searching, startSearch] = useTransition();
  const [adding, setAdding] = useState<Candidate | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  function plan() {
    if (!aiEnabled) {
      setConfig({ ...EMPTY, searchQueries: [query.slice(0, 200)] });
      return;
    }
    startPlan(async () => {
      const res = await planDiscovery({ query });
      if (res.ok) setConfig(res.data);
      else toast.error(res.error);
    });
  }

  function search() {
    if (!config) return;
    startSearch(async () => {
      const res = await runDiscovery({ query, config: { ...config, searchQueries: config.searchQueries.filter((q) => q.trim()) } });
      if (res.ok) {
        toast.success(`${res.data.found} candidates from ${res.data.searched} results`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const shown = candidates.filter((c) => (filter === "pending" ? c.reviewStatus === "pending" : true));
  const set = (k: keyof DiscoveryConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config!, [k]: k === "maxResults" ? Number(e.target.value) : e.target.value });

  return (
    <div className="space-y-5">
      {!searchEnabled && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>No search API connected</AlertTitle>
          <AlertDescription>
            You can still plan a search, then use the generated queries yourself. To run searches here, add a Brave Search API key (see <Link href="/integrations" className="underline">Integrations</Link>). You can also <Link href="/prospects/import" className="underline">import a CSV</Link>.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Describe who you're looking for</CardTitle>
            <CardDescription>Plain English. {aiEnabled ? "The AI turns it into an editable search plan." : "You'll fill in the search plan yourself."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={4} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={EXAMPLES[0]} aria-label="Discovery request" />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setQuery(ex)} className="rounded-md border px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {ex.slice(0, 60)}…
                </button>
              ))}
            </div>
            <Button onClick={plan} disabled={planning || query.trim().length < 10}>
              {planning ? <Spinner /> : <Sparkles />} {aiEnabled ? "Build search plan" : "Start a search plan"}
            </Button>
          </CardContent>
        </Card>

        {config && (
          <Card>
            <CardHeader>
              <CardTitle>Search plan</CardTitle>
              <CardDescription>Review and edit before running.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["companyType", "Company type"],
                      ["industry", "Industry"],
                      ["geography", "Geography"],
                      ["companySize", "Company size"],
                      ["decisionMakerRole", "Decision-maker role"],
                      ["serviceRelevance", "Service relevance"],
                    ] as const
                  ).map(([k, l]) => (
                    <Field key={k}>
                      <FieldLabel htmlFor={`dc-${k}`}>{l}</FieldLabel>
                      <Input id={`dc-${k}`} value={config[k] as string} onChange={set(k)} />
                    </Field>
                  ))}
                </div>
                <Field>
                  <FieldLabel htmlFor="dc-ev">Required evidence</FieldLabel>
                  <Input id="dc-ev" value={config.requiredEvidence} onChange={set("requiredEvidence")} />
                </Field>
                <Field>
                  <FieldLabel>Search queries</FieldLabel>
                  {config.searchQueries.map((q, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={q} onChange={(e) => setConfig({ ...config, searchQueries: config.searchQueries.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Query ${i + 1}`} />
                      <Button size="icon-sm" variant="ghost" aria-label="Copy query" onClick={() => { navigator.clipboard.writeText(q); toast.success("Copied"); }}>
                        <Copy />
                      </Button>
                    </div>
                  ))}
                  {config.searchQueries.length < 3 && (
                    <Button size="xs" variant="outline" className="w-fit" onClick={() => setConfig({ ...config, searchQueries: [...config.searchQueries, ""] })}>Add query</Button>
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel>Source</FieldLabel>
                    <Select value={config.source} onValueChange={(v) => setConfig({ ...config, source: v as DiscoveryConfig["source"] })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="search_api">Search API</SelectItem>
                        <SelectItem value="csv">My CSV list</SelectItem>
                        <SelectItem value="manual">Manual research</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="dc-max">Max results</FieldLabel>
                    <Input id="dc-max" type="number" min={1} max={50} value={config.maxResults} onChange={set("maxResults")} />
                  </Field>
                </div>
                <FieldDescription>Searches look for public business pages only. Emails and private contact details are never collected.</FieldDescription>
                <Button onClick={search} disabled={searching || !searchEnabled || config.source !== "search_api" || !config.searchQueries.some((q) => q.trim())}>
                  {searching ? <Spinner /> : <Search />} Run search
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Candidates</h2>
        <Select value={filter} onValueChange={(v) => setFilter(v as "pending" | "all")}>
          <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Needs review</SelectItem>
            <SelectItem value="all">All candidates</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Search} title="No candidates to review" description="Run a search to find companies. Each result shows why it was included and what's uncertain." />
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Candidate</TableHead>
                <TableHead>Why included</TableHead>
                <TableHead className="hidden lg:table-cell">Uncertainty</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} className="align-top">
                  <TableCell className="max-w-56 pl-4 whitespace-normal">
                    <p className="font-medium">{c.candidateCompany ?? hostname(c.candidateWebsite)}</p>
                    {c.candidateName && <p className="text-xs">{c.candidateName}{c.candidateTitle ? ` · ${c.candidateTitle}` : ""}</p>}
                    {c.sourceUrl && (
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                        {hostname(c.sourceUrl)} <ExternalLink className="size-3" />
                      </a>
                    )}
                    {c.reviewStatus !== "pending" && <Badge variant="outline" className="mt-1 font-normal">{c.reviewStatus}</Badge>}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    <p className="text-sm">{c.reason}</p>
                    {c.evidence && <p className="mt-1 text-xs text-muted-foreground">“{c.evidence}”</p>}
                  </TableCell>
                  <TableCell className="hidden max-w-64 text-xs whitespace-normal text-muted-foreground lg:table-cell">{c.uncertainty}</TableCell>
                  <TableCell className="pr-4">
                    {c.reviewStatus === "pending" && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="xs" onClick={() => setAdding(c)}>
                          <UserPlus /> Add
                        </Button>
                        <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => reviewCandidate({ id: c.id, status: "duplicate" }), { success: "Marked duplicate" })}>
                          Duplicate
                        </Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Dismiss" disabled={pending} onClick={() => run(() => reviewCandidate({ id: c.id, status: "dismissed" }), { success: "Dismissed" })}>
                          <XIcon />
                        </Button>
                      </div>
                    )}
                    {c.reviewStatus === "added" && c.prospectId && (
                      <div className="flex justify-end">
                        <Button asChild size="xs" variant="outline">
                          <Link href={`/prospects/${c.prospectId}`}>Open</Link>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {runs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Recent searches ({runs.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {runs.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleString()} · {r.status}
                {r.error ? ` — ${r.error}` : ""} · {r.query.slice(0, 100)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {adding && <AddDialog c={adding} campaigns={campaigns} onDone={() => setAdding(null)} />}
    </div>
  );
}
