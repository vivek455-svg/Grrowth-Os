"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  ExternalLink,
  FileCheck2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProspectPicker, type PickedProspect } from "@/components/app/prospect-picker";
import { MessageStatusBadge } from "@/components/app/badges";
import { generateFollowUp, generateOutreach, saveMessageDraft, type OutreachDraft } from "@/server/actions/ai-outreach";
import { approveMessage, cancelMessage, recordManualSend, sendEmailViaGmail } from "@/server/actions/sending";
import { useAction } from "@/hooks/use-action";
import { CHANNEL_LABEL } from "@/lib/labels";
import { fmtDateTime, toLocalInput } from "@/lib/format";
import type { Channel, OutreachMessage, ResearchObservation } from "@/db/schema";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/app/time-ago";

export type ComposerContext = {
  prospect: {
    id: string;
    fullName: string;
    company: string | null;
    jobTitle: string | null;
    email: string | null;
    linkedinUrl: string | null;
    xUrl: string | null;
    preferredChannel: Channel | null;
    lastContactedAt: Date | null;
    personalizationNotes: string | null;
  };
  research: { reviewStatus: string; whatTheyDo: string | null; observations: ResearchObservation[]; url: string | null } | null;
  recent: { id: string; type: string; direction: string; occurredAt: Date; content: string | null }[];
  blocked: string | null;
  cooldown: string | null;
  replyPending: boolean;
  messages: OutreachMessage[];
};

const VARIANT_LABEL = { short: "Short", value_first: "Value-first", relationship: "Relationship-first" } as const;

function openUrl(channel: Channel, p: ComposerContext["prospect"], subject: string, body: string) {
  if (channel === "email" && p.email) return `mailto:${p.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (channel === "linkedin") return p.linkedinUrl;
  if (channel === "x") return p.xUrl;
  return null;
}

function MessageCard({ m, ctx, gmailConnected, onRevise }: { m: OutreachMessage; ctx: ComposerContext; gmailConnected: boolean; onRevise: (m: OutreachMessage) => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [preview, setPreview] = useState(false);
  const [manual, setManual] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, startSend] = useTransition();
  const [sentAt, setSentAt] = useState(toLocalInput(new Date()));
  const [followUp, setFollowUp] = useState(true);
  const [followUpAt, setFollowUpAt] = useState(format(addDays(new Date(), 5), "yyyy-MM-dd'T'09:00"));
  const url = openUrl(m.channel, ctx.prospect, m.subject ?? "", m.body);

  return (
    <Card size="sm" className={cn(m.status === "cancelled" && "opacity-60")}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <MessageStatusBadge status={m.status} method={m.sendMethod} />
        <span className="text-xs text-muted-foreground">
          {CHANNEL_LABEL[m.channel]} · {m.kind.replace("_", " ")} · version {m.version}
        </span>
        <span className="num ml-auto text-xs text-muted-foreground">{fmtDateTime(m.sentAt ?? m.approvedAt ?? m.createdAt)}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {m.subject && <p className="text-sm font-medium">Subject: {m.subject}</p>}
        <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-line">{m.body}</p>
        {m.unsupportedClaims.length > 0 && (
          <ul className="space-y-1 text-xs text-warning">
            {m.unsupportedClaims.map((c) => (
              <li key={c} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{c}</li>
            ))}
          </ul>
        )}
        {m.error && <p className="text-xs text-destructive">Last attempt failed: {m.error}</p>}
        <div className="flex flex-wrap gap-2">
          {m.status === "draft" && (
            <>
              <Button size="sm" disabled={pending || !!ctx.blocked} onClick={() => run(() => approveMessage({ id: m.id }), { success: "Approved. Choose how to send it.", onSuccess: () => router.refresh() })}>
                <FileCheck2 /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRevise(m)}>Revise</Button>
            </>
          )}
          {(m.status === "approved" || (m.status === "failed" && !m.externalMessageId)) && (
            <>
              {m.channel === "email" && gmailConnected && (
                <Button size="sm" onClick={() => { setConfirmed(false); setPreview(true); }}>
                  <Send /> {m.status === "failed" ? "Retry via Gmail" : "Send via Gmail"}
                </Button>
              )}
              <Button
                size="sm"
                variant={m.channel === "email" && gmailConnected ? "outline" : "default"}
                onClick={async () => {
                  await navigator.clipboard.writeText(m.subject ? `${m.subject}\n\n${m.body}` : m.body);
                  toast.success("Copied. Send it, then confirm below.");
                  setManual(true);
                }}
              >
                <ClipboardCopy /> Copy{url ? " & open" : ""}
              </Button>
              {url && (
                <Button asChild size="sm" variant="outline">
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open {m.channel === "email" ? "mail app" : CHANNEL_LABEL[m.channel]}
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setManual(true)}>I sent it</Button>
            </>
          )}
          {["draft", "approved", "failed"].includes(m.status) && (
            <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => cancelMessage({ id: m.id }), { success: "Discarded", onSuccess: () => router.refresh() })}>
              Discard
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send this email?</DialogTitle>
            <DialogDescription>It will be sent from your connected Gmail account. This can't be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p><span className="text-muted-foreground">To:</span> {ctx.prospect.email}</p>
            <p><span className="text-muted-foreground">Subject:</span> {m.subject}</p>
            <p className="border-t pt-2 whitespace-pre-line">{m.body}</p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`confirm-${m.id}`} checked={confirmed} onCheckedChange={(c) => setConfirmed(!!c)} />
            <Label htmlFor={`confirm-${m.id}`} className="text-sm font-normal">I've checked every claim in this message.</Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(false)}>Cancel</Button>
            <Button
              disabled={!confirmed || sending}
              onClick={() =>
                startSend(async () => {
                  const res = await sendEmailViaGmail({ id: m.id });
                  if (res.ok) {
                    toast.success("Sent via Gmail");
                    setPreview(false);
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              {sending && <Spinner />} Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm you sent it</DialogTitle>
            <DialogDescription>
              Only confirm after the message was actually sent on {CHANNEL_LABEL[m.channel]}. It's recorded as “logged manually”, not as delivered.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`sent-${m.id}`}>Sent at</FieldLabel>
              <Input id={`sent-${m.id}`} type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id={`fu-${m.id}`} checked={followUp} onCheckedChange={(c) => setFollowUp(!!c)} />
              <Label htmlFor={`fu-${m.id}`} className="text-sm font-normal">Remind me to follow up if there's no reply</Label>
            </div>
            {followUp && <Input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} aria-label="Follow-up date" />}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManual(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => recordManualSend({ id: m.id, sentAt: new Date(sentAt), followUpAt: followUp ? new Date(followUpAt) : null }), {
                  success: "Recorded as sent",
                  onSuccess: () => {
                    setManual(false);
                    router.refresh();
                  },
                })
              }
            >
              {pending && <Spinner />} Record as sent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function Composer({
  ctx,
  aiEnabled,
  gmailConnected,
  campaigns,
  initialChannel,
  initialKind,
  initialMessageId,
  initialCampaignId,
}: {
  ctx: ComposerContext | null;
  aiEnabled: boolean;
  gmailConnected: boolean;
  campaigns: { id: string; name: string }[];
  initialChannel: Channel | null;
  initialKind: "initial" | "follow_up" | "connection_request";
  initialMessageId: string | null;
  initialCampaignId?: string | null;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [generating, startGen] = useTransition();
  const p = ctx?.prospect;
  const revising = ctx?.messages.find((m) => m.id === initialMessageId && m.status === "draft") ?? null;
  const [channel, setChannel] = useState<Channel>(revising?.channel ?? initialChannel ?? p?.preferredChannel ?? (p?.email ? "email" : p?.linkedinUrl ? "linkedin" : "x"));
  const [kind, setKind] = useState<"initial" | "follow_up" | "connection_request">((revising?.kind as "initial") ?? initialKind);
  const [goal, setGoal] = useState<"start_conversation" | "offer_ideas" | "agency_partnership" | "follow_up_content" | "reconnect">("start_conversation");
  const [campaignId, setCampaignId] = useState(revising?.campaignId ?? initialCampaignId ?? "none");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<(OutreachDraft & { followUp?: false }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("custom");
  const [bodies, setBodies] = useState<Record<string, { subject: string; body: string }>>(revising ? { custom: { subject: revising.subject ?? "", body: revising.body } } : { custom: { subject: "", body: "" } });
  const [previousId, setPreviousId] = useState<string | null>(revising?.id ?? null);

  if (!ctx || !p)
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Who are you writing to?</CardTitle>
          <CardDescription>Pick a prospect. Personalisation uses their research, notes and conversation history.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProspectPicker value={null} onChange={(x: PickedProspect | null) => x && router.push(`/outreach/compose?prospect=${x.id}`)} />
        </CardContent>
      </Card>
    );

  function generate() {
    setError(null);
    startGen(async () => {
      if (kind === "follow_up") {
        const res = await generateFollowUp({ prospectId: p!.id, channel });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setBodies({ ...bodies, custom: { subject: res.data.subject ?? "", body: res.data.body } });
        setDraft(null);
        setTab("custom");
        if (res.data.warnings.length) toast.warning(res.data.warnings.join(" · "));
        return;
      }
      const res = await generateOutreach({ prospectId: p!.id, channel, goal, kind: kind === "connection_request" ? "connection_request" : "initial", campaignId: campaignId === "none" ? null : campaignId, extraNotes: notes });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(res.data);
      const next = { ...bodies };
      for (const v of res.data.variants) next[v.variant] = { subject: v.subject ?? "", body: v.body };
      setBodies(next);
      setTab(res.data.variants[0]?.variant ?? "short");
    });
  }

  function save() {
    const cur = bodies[tab] ?? { subject: "", body: "" };
    const variant = tab === "custom" ? "custom" : (tab as "short");
    run(
      () =>
        saveMessageDraft({
          prospectId: p!.id,
          channel,
          kind,
          variant,
          subject: channel === "email" ? cur.subject : null,
          body: cur.body,
          campaignId: campaignId === "none" ? null : campaignId,
          previousVersionId: previousId,
          generationId: tab !== "custom" ? (draft?.generationId ?? null) : null,
          unsupportedClaims: tab !== "custom" ? (draft?.warnings[tab] ?? []) : [],
        }),
      {
        success: previousId ? "Saved as a new version" : "Draft saved — approve it below when ready",
        onSuccess: () => {
          setPreviousId(null);
          router.refresh();
        },
      },
    );
  }

  const current = bodies[tab] ?? { subject: "", body: "" };
  const active = ctx.messages.filter((m) => ["draft", "approved", "sending", "failed"].includes(m.status));
  const history = ctx.messages.filter((m) => !["draft", "approved", "sending", "failed"].includes(m.status));
  const channelMissing = (channel === "email" && !p.email) || (channel === "linkedin" && !p.linkedinUrl) || (channel === "x" && !p.xUrl);

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              <Link href={`/prospects/${p.id}`} className="hover:underline">{p.fullName}</Link>
            </CardTitle>
            <CardDescription>{[p.jobTitle, p.company].filter(Boolean).join(" · ")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ShieldCheck className="size-3.5" /> Safeguards</p>
              {ctx.blocked ? (
                <p className="flex gap-1.5 text-destructive"><Ban className="mt-0.5 size-3.5 shrink-0" />{ctx.blocked}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> Not suppressed or opted out</li>
                  <li className={cn("flex gap-1.5", ctx.cooldown && "text-warning")}>
                    {ctx.cooldown ? <AlertTriangle className="mt-0.5 size-3 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />}
                    {ctx.cooldown ?? (p.lastContactedAt ? <span>Last contacted <TimeAgo date={p.lastContactedAt} /></span> : "Never contacted")}
                  </li>
                  {ctx.replyPending && (
                    <li className="flex gap-1.5 text-warning"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> They replied last — respond to the conversation, not a follow-up.</li>
                  )}
                </ul>
              )}
            </div>
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Research</p>
              {!ctx.research ? (
                <p className="text-xs text-warning">
                  No research yet. <Link href={`/prospects/${p.id}`} className="underline">Research first</Link> — generic messages get ignored.
                </p>
              ) : (
                <>
                  <Badge variant={ctx.research.reviewStatus === "reviewed" ? "secondary" : "outline"} className={cn("gap-1 font-normal", ctx.research.reviewStatus !== "reviewed" && "border-dashed")}>
                    {ctx.research.reviewStatus === "reviewed" ? <CheckCircle2 className="size-3 text-success" /> : <CircleDashed className="size-3" />}
                    {ctx.research.reviewStatus === "reviewed" ? "Reviewed" : "Unreviewed draft"}
                  </Badge>
                  {ctx.research.whatTheyDo && <p className="text-xs">{ctx.research.whatTheyDo}</p>}
                  <ul className="space-y-1 text-xs">
                    {ctx.research.observations.slice(0, 5).map((o, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", o.kind === "verified" ? "bg-success" : "bg-muted-foreground/50")} />
                        <span>{o.text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {ctx.recent.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Recent conversation</p>
                <ul className="space-y-2 text-xs">
                  {ctx.recent.slice(0, 4).map((e) => (
                    <li key={e.id}>
                      <span className="text-muted-foreground">{e.direction === "inbound" ? "They" : "You"} · <TimeAgo date={e.occurredAt} /></span>
                      <p className="line-clamp-2">{e.content}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardContent>
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel>Channel</FieldLabel>
                  <ToggleGroup type="single" variant="outline" size="sm" value={channel} onValueChange={(v) => v && setChannel(v as Channel)} className="w-full">
                    <ToggleGroupItem value="email" className="flex-1">Email</ToggleGroupItem>
                    <ToggleGroupItem value="linkedin" className="flex-1">LinkedIn</ToggleGroupItem>
                    <ToggleGroupItem value="x" className="flex-1">X</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel>Message type</FieldLabel>
                  <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="initial">First message</SelectItem>
                      {channel === "linkedin" && <SelectItem value="connection_request">Connection request note</SelectItem>}
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {kind !== "follow_up" && (
                  <Field>
                    <FieldLabel>Goal</FieldLabel>
                    <Select value={goal} onValueChange={(v) => setGoal(v as typeof goal)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="start_conversation">Start a conversation</SelectItem>
                        <SelectItem value="offer_ideas">Offer landing page ideas</SelectItem>
                        <SelectItem value="agency_partnership">Agency partnership</SelectItem>
                        <SelectItem value="follow_up_content">They engaged with my content</SelectItem>
                        <SelectItem value="reconnect">Reconnect</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
              {campaigns.length > 0 && (
                <Field>
                  <FieldLabel>Campaign</FieldLabel>
                  <Select value={campaignId} onValueChange={setCampaignId}>
                    <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No campaign</SelectItem>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {aiEnabled && kind !== "follow_up" && (
                <Field>
                  <FieldLabel htmlFor="cmp-notes">Anything else to use?</FieldLabel>
                  <Textarea id="cmp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="A recent post of theirs you read, a mutual context, what you'd suggest…" />
                  <FieldDescription>Only facts you add here or in research will be used.</FieldDescription>
                </Field>
              )}
              {channelMissing && <p className="text-xs text-warning">No {CHANNEL_LABEL[channel]} contact saved for this prospect.</p>}
              <div className="flex flex-wrap gap-2">
                {aiEnabled ? (
                  <Button onClick={generate} disabled={generating || !!ctx.blocked}>
                    {generating ? <Spinner /> : <Sparkles />} {generating ? "Writing…" : draft || bodies.custom?.body ? "Regenerate" : kind === "follow_up" ? "Draft follow-up" : "Generate 3 versions"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    AI drafting is off — write below, or <Link href="/integrations" className="underline">connect an AI provider</Link>.
                  </p>
                )}
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Couldn't draft the message</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {generating && !draft && (
          <Card className="space-y-3 px-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-28 w-full" />
          </Card>
        )}

        {draft && (
          <Card size="sm" className={cn(generating && "opacity-60")}>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">What they do</p>
                <p>{draft.company_summary}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Observation used</p>
                <p>{draft.observation}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Why your services fit</p>
                <p className={cn(!draft.fit_is_reasonable && "text-warning")}>{draft.service_fit}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Relevant portfolio work</p>
                <p>{draft.portfolio ? `${draft.portfolio.name} — ${draft.portfolio.reason ?? ""}` : "None selected"}</p>
              </div>
              {!draft.usedResearch && <p className="text-xs text-warning sm:col-span-2">No research on file — this draft relies only on profile fields and notes.</p>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{previousId ? "Revise draft" : "Message"}</CardTitle>
            <CardDescription>Edit freely. Saving creates a draft; nothing is sent until you approve and send it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {draft?.variants.map((v) => (
                  <TabsTrigger key={v.variant} value={v.variant}>
                    {VARIANT_LABEL[v.variant]}
                    {(draft.warnings[v.variant]?.length ?? 0) > 0 && <AlertTriangle className="size-3 text-warning" />}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="custom">{draft ? "Write my own" : "Message"}</TabsTrigger>
              </TabsList>
              {[...(draft?.variants.map((v) => v.variant) ?? []), "custom"].map((k) => (
                <TabsContent key={k} value={k} className="mt-3 space-y-3">
                  {channel === "email" && (
                    <Input
                      placeholder="Subject"
                      value={bodies[k]?.subject ?? ""}
                      onChange={(e) => setBodies({ ...bodies, [k]: { ...(bodies[k] ?? { body: "" }), subject: e.target.value } })}
                      aria-label="Subject"
                    />
                  )}
                  <Textarea
                    rows={9}
                    value={bodies[k]?.body ?? ""}
                    onChange={(e) => setBodies({ ...bodies, [k]: { ...(bodies[k] ?? { subject: "" }), body: e.target.value } })}
                    placeholder="Hi …"
                    aria-label="Message body"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{kind === "connection_request" ? "LinkedIn connection notes are limited to 300 characters" : ""}</span>
                    <span className={cn("num", kind === "connection_request" && (bodies[k]?.body.length ?? 0) > 300 && "text-destructive")}>{bodies[k]?.body.length ?? 0} chars</span>
                  </div>
                  {k !== "custom" && draft && (
                    <>
                      {(draft.warnings[k]?.length ?? 0) > 0 && (
                        <Alert>
                          <AlertTriangle />
                          <AlertTitle>Check before approving</AlertTitle>
                          <AlertDescription>
                            <ul className="list-disc pl-4">
                              {draft.warnings[k]!.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Claims and their sources</summary>
                        <ul className="mt-2 space-y-1">
                          {draft.variants
                            .find((v) => v.variant === k)
                            ?.claims.map((c, i) => (
                              <li key={i} className="flex gap-2">
                                <Badge variant="outline" className={cn("h-fit font-normal", c.support === "none" && "border-destructive text-destructive")}>{c.support}</Badge>
                                {c.claim}
                              </li>
                            ))}
                        </ul>
                      </details>
                    </>
                  )}
                </TabsContent>
              ))}
            </Tabs>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button onClick={save} disabled={pending || !current.body.trim() || !!ctx.blocked}>
                {pending && <Spinner />} {previousId ? "Save new version" : "Save draft"}
              </Button>
              {aiEnabled && draft && (
                <Button variant="ghost" size="sm" onClick={generate} disabled={generating}>
                  <RefreshCw /> Regenerate all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {active.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Review queue for {p.fullName.split(" ")[0]}</h2>
            {active.map((m) => (
              <MessageCard
                key={m.id}
                m={m}
                ctx={ctx}
                gmailConnected={gmailConnected}
                onRevise={(msg) => {
                  setBodies({ ...bodies, custom: { subject: msg.subject ?? "", body: msg.body } });
                  setChannel(msg.channel);
                  setTab("custom");
                  setPreviousId(msg.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </section>
        )}
        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Version history & sent messages ({history.length})</summary>
            <ul className="mt-3 space-y-2">
              {history.map((m) => (
                <li key={m.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <MessageStatusBadge status={m.status} method={m.sendMethod} />
                    <span className="text-xs text-muted-foreground">v{m.version} · {CHANNEL_LABEL[m.channel]} · {fmtDateTime(m.sentAt ?? m.createdAt)}</span>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{m.body}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        {!gmailConnected && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> Email sending uses copy & open until you <Link href="/integrations" className="underline">connect Gmail</Link>. LinkedIn and X messages are always sent by you, then logged here.
          </p>
        )}
      </div>
    </div>
  );
}
