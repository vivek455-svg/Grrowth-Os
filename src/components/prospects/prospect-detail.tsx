"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Briefcase,
  CalendarClock,
  Check,
  ExternalLink,
  Globe,
  Mail,
  MessageSquarePlus,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FitScore, MessageStatusBadge } from "@/components/app/badges";
import { useShell } from "@/components/app/shell-context";
import { ProspectFormDialog } from "./prospect-form";
import { FollowUpDialog } from "./follow-up-dialog";
import { ResearchPanel } from "./research-panel";
import { Timeline } from "./timeline";
import { OpportunityDialog } from "@/components/pipeline/opportunity-dialog";
import { deleteProspect, updateFollowUp, updateProspect } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, hostname } from "@/lib/format";
import { CHANNEL_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import type { prospectDetail } from "@/server/queries/prospects";
import { cn } from "@/lib/utils";

type Detail = NonNullable<Awaited<ReturnType<typeof prospectDetail>>>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function ProspectDetail({ d, aiEnabled, campaigns }: { d: Detail; aiEnabled: boolean; campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const { openLogInteraction } = useShell();
  const { run, pending } = useAction();
  const p = d.prospect;
  const [edit, setEdit] = useState(false);
  const [fu, setFu] = useState(false);
  const [opp, setOpp] = useState(false);
  const [del, setDel] = useState(false);
  const picked = { id: p.id, name: p.fullName, company: p.company };
  const statusLabel = (k: string) => d.statuses.find((s) => s.key === k)?.label ?? k;
  const pendingFollowUps = d.followUps.filter((f) => f.status === "pending");
  const lastOutbound = d.events.find((e) => e.direction === "outbound");
  const lastInbound = d.events.find((e) => e.direction === "inbound");
  const awaitingReply = lastOutbound && (!lastInbound || lastInbound.occurredAt < lastOutbound.occurredAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="xs" className="-ml-2 mb-1 text-muted-foreground">
            <Link href="/prospects">
              <ArrowLeft /> Prospects
            </Link>
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{p.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {[p.jobTitle, p.company].filter(Boolean).join(" · ") || "No title or company"}
            {p.location ? ` · ${p.location}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {p.companyWebsite && (
              <Button asChild size="xs" variant="outline">
                <a href={p.companyWebsite} target="_blank" rel="noreferrer">
                  <Globe /> {hostname(p.companyWebsite)}
                </a>
              </Button>
            )}
            {p.linkedinUrl && (
              <Button asChild size="xs" variant="outline">
                <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                  LinkedIn <ExternalLink />
                </a>
              </Button>
            )}
            {p.xUrl && (
              <Button asChild size="xs" variant="outline">
                <a href={p.xUrl} target="_blank" rel="noreferrer">
                  X <ExternalLink />
                </a>
              </Button>
            )}
            {p.email && (
              <Button asChild size="xs" variant="outline">
                <a href={`mailto:${p.email}`}>
                  <Mail /> {p.email}
                </a>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openLogInteraction(picked)}>
            <NotebookPen /> Log interaction
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFu(true)} disabled={!!d.suppressed}>
            <CalendarClock /> Follow-up
          </Button>
          <Button asChild size="sm" disabled={!!d.suppressed}>
            <Link href={`/outreach/compose?prospect=${p.id}`} aria-disabled={!!d.suppressed} className={cn(d.suppressed && "pointer-events-none opacity-50")}>
              <MessageSquarePlus /> Draft outreach
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEdit(true)}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpp(true)}>
                <Briefcase /> Create opportunity
              </DropdownMenuItem>
              {p.status !== "do_not_contact" && (
                <DropdownMenuItem onSelect={() => run(() => updateProspect({ id: p.id, status: "do_not_contact" }), { success: "Marked do not contact. Pending follow-ups cancelled." })}>
                  <Ban /> Mark do not contact
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDel(true)}>
                <Trash2 /> Delete prospect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {d.suppressed && (
        <Alert variant="destructive">
          <Ban />
          <AlertTitle>Outreach blocked</AlertTitle>
          <AlertDescription>{d.suppressed}. Drafting, sending and follow-ups are disabled for this prospect.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Tabs defaultValue="overview" className="min-w-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="research">Research ({d.research.length})</TabsTrigger>
            <TabsTrigger value="timeline">Timeline ({d.events.length})</TabsTrigger>
            <TabsTrigger value="messages">Messages ({d.messages.filter((m) => m.status !== "cancelled").length})</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-3 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Qualification</CardTitle>
                <CardAction>
                  <Button size="xs" variant="ghost" onClick={() => setEdit(true)}>
                    <Pencil /> Edit
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Row label="Fit score"><span className="inline-flex items-center gap-2"><FitScore score={p.fitScore} /> {p.fitExplanation && <span className="text-muted-foreground">{p.fitExplanation}</span>}</span></Row>
                  <Row label="Persona">{p.persona}</Row>
                  <Row label="Company type">{[p.companyType, p.industry, p.companySize].filter(Boolean).join(" · ")}</Row>
                  <Row label="Services">{p.relevantServices.join(", ")}</Row>
                  <Row label="Business problem">{p.businessProblem}</Row>
                  <Row label="Website to evaluate">{p.websiteUrl && <a className="hover:underline" href={p.websiteUrl} target="_blank" rel="noreferrer">{p.websiteUrl}</a>}</Row>
                  <Row label="Personalization">{p.personalizationNotes}</Row>
                  <Row label="Source">{p.source}</Row>
                  <Row label="Tags">{p.tags.length ? <span className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t} variant="outline" className="font-normal">{t}</Badge>)}</span> : null}</Row>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                <Timeline events={d.events.slice(0, 5)} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="research" className="mt-3">
            <ResearchPanel prospectId={p.id} research={d.research} defaultUrl={p.websiteUrl ?? p.companyWebsite} aiEnabled={aiEnabled} />
          </TabsContent>
          <TabsContent value="timeline" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle>Interaction history</CardTitle>
                <CardAction>
                  <Button size="xs" variant="outline" onClick={() => openLogInteraction(picked)}>
                    <NotebookPen /> Log
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Timeline events={d.events} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="messages" className="mt-3">
            <Card className="gap-0 py-0">
              {d.messages.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No drafted or sent messages yet.</p>
              ) : (
                <ul className="divide-y">
                  {d.messages.map((m) => (
                    <li key={m.id} className={cn("space-y-1.5 px-4 py-3", m.status === "cancelled" && "opacity-60")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <MessageStatusBadge status={m.status} method={m.sendMethod} />
                        <span className="text-xs text-muted-foreground">
                          {CHANNEL_LABEL[m.channel]} · {m.kind.replace("_", " ")} · v{m.version}
                          {m.variant && m.variant !== "custom" ? ` · ${m.variant.replace("_", "-")}` : ""}
                        </span>
                        <span className="num ml-auto text-xs text-muted-foreground">{fmtDateTime(m.sentAt ?? m.createdAt)}</span>
                      </div>
                      {m.subject && <p className="text-sm font-medium">{m.subject}</p>}
                      <p className="line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{m.body}</p>
                      {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                      {(m.status === "draft" || m.status === "approved" || m.status === "failed") && (
                        <Button asChild size="xs" variant="outline">
                          <Link href={`/outreach/compose?prospect=${p.id}&message=${m.id}`}>Open in composer</Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <Card size="sm">
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Lead status</p>
                <Select value={p.status} onValueChange={(v) => run(() => updateProspect({ id: p.id, status: v }), { success: `Status: ${statusLabel(v)}` })} disabled={pending}>
                  <SelectTrigger className="w-full" aria-label="Lead status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {d.statuses.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Priority</p>
                  <p>{PRIORITY_LABEL[p.priority]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Preferred channel</p>
                  <p>{p.preferredChannel ? CHANNEL_LABEL[p.preferredChannel] : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last contacted</p>
                  <p>{p.lastContactedAt ? fmtRelative(p.lastContactedAt) : "Never"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last interaction</p>
                  <p>{p.lastInteractionAt ? fmtRelative(p.lastInteractionAt) : "—"}</p>
                </div>
              </div>
              {awaitingReply && (
                <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  Waiting for a reply since {fmtDate(lastOutbound!.occurredAt)}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Follow-ups</CardTitle>
              <CardAction>
                <Button size="xs" variant="ghost" onClick={() => setFu(true)} disabled={!!d.suppressed}>Add</Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {pendingFollowUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">None scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {pendingFollowUps.map((f) => {
                    const overdue = f.dueAt < new Date();
                    return (
                      <li key={f.id} className="flex items-start gap-2 text-sm">
                        <CalendarClock className={cn("mt-0.5 size-4 shrink-0", overdue ? "text-destructive" : "text-muted-foreground")} />
                        <div className="min-w-0 flex-1">
                          <p className={cn("num", overdue && "font-medium text-destructive")}>{fmtDateTime(f.dueAt)}{overdue ? " · overdue" : ""}</p>
                          {f.reason && <p className="truncate text-xs text-muted-foreground">{f.reason}</p>}
                        </div>
                        <Button size="icon-xs" variant="ghost" aria-label="Mark done" onClick={() => run(() => updateFollowUp({ id: f.id, status: "done" }), { success: "Follow-up done" })}>
                          <Check />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Opportunities</CardTitle>
              <CardAction>
                <Button size="xs" variant="ghost" onClick={() => setOpp(true)}>Add</Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {d.opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.opportunities.map(({ o, stageLabel }) => (
                    <li key={o.id}>
                      <Link href={`/opportunities?open=${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                      <p className="text-xs text-muted-foreground">{stageLabel} · {fmtMoney(o.valueCents, o.currency)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {d.campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not in any campaign. Add from the prospect list.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {d.campaigns.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/campaigns/${c.id}`} className="truncate hover:underline">{c.name}</Link>
                      <Badge variant="outline" className="font-normal">{c.state}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {d.sources.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {d.sources.map((s) => (
                  <div key={s.id}>
                    <p>{s.sourceType.replace("_", " ")}{s.reason ? ` — ${s.reason}` : ""}</p>
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">{s.sourceUrl}</a>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {!p.email && !p.linkedinUrl && !p.xUrl && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> No contact channel saved. Add a LinkedIn or X profile, or an email they've published.
            </p>
          )}
        </div>
      </div>

      {edit && <ProspectFormDialog open onOpenChange={setEdit} statuses={d.statuses} prospect={p} />}
      {fu && <FollowUpDialog prospectId={p.id} open onOpenChange={setFu} suggestedDays={5} />}
      {opp && (
        <OpportunityDialog
          open
          onOpenChange={setOpp}
          stages={d.stages}
          campaigns={campaigns}
          prospect={picked}
          defaultStage="qualified"
        />
      )}
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>Removes the prospect, timeline, research and drafts. To stop outreach while keeping history, mark them “Do not contact”.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => run(() => deleteProspect({ id: p.id }), { success: "Prospect deleted", onSuccess: () => router.push("/prospects") })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
