"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ProspectPicker, type PickedProspect } from "@/components/app/prospect-picker";
import { saveOpportunity } from "@/server/actions/pipeline";
import { useAction } from "@/hooks/use-action";
import { SOURCE_CHANNEL_LABEL } from "@/lib/labels";
import { toDateInput, toLocalInput } from "@/lib/format";
import type { Opportunity } from "@/db/schema";

export function OpportunityDialog({
  open,
  onOpenChange,
  stages,
  campaigns,
  content,
  prospect,
  opportunity,
  defaultStage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stages: { key: string; label: string }[];
  campaigns: { id: string; name: string }[];
  content?: { id: string; title: string }[];
  prospect?: PickedProspect | null;
  opportunity?: Opportunity | null;
  defaultStage?: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const o = opportunity;
  const [picked, setPicked] = useState<PickedProspect | null>(prospect ?? null);
  const [v, setV] = useState({
    name: o?.name ?? (prospect ? `${prospect.company ?? prospect.name} — ` : ""),
    company: o?.company ?? prospect?.company ?? "",
    serviceType: o?.serviceType ?? "",
    value: o?.valueCents != null ? String(o.valueCents / 100) : "",
    currency: o?.currency ?? "USD",
    expectedCloseDate: toDateInput(o?.expectedCloseDate),
    stage: o?.stage ?? defaultStage ?? stages[0]?.key ?? "qualified",
    sourceChannel: o?.sourceChannel ?? "none",
    outreachCampaignId: o?.outreachCampaignId ?? "none",
    contentItemId: o?.contentItemId ?? "none",
    nextAction: o?.nextAction ?? "",
    nextActionAt: toLocalInput(o?.nextActionAt),
    outcomeNotes: o?.outcomeNotes ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  function submit() {
    run(
      () =>
        saveOpportunity({
          id: o?.id,
          ...v,
          prospectId: picked?.id ?? null,
          sourceChannel: v.sourceChannel === "none" ? null : (v.sourceChannel as "content"),
          outreachCampaignId: v.outreachCampaignId === "none" ? null : v.outreachCampaignId,
          contentItemId: v.contentItemId === "none" ? null : v.contentItemId,
        }),
      {
        success: o ? "Opportunity saved" : "Opportunity created",
        onSuccess: () => {
          onOpenChange(false);
          router.refresh();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{o ? "Edit opportunity" : "New opportunity"}</DialogTitle>
          <DialogDescription>Revenue figures are only ever calculated from what you record here.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="op-name">Name</FieldLabel>
            <Input id="op-name" value={v.name} onChange={set("name")} placeholder="Company — Homepage redesign" />
          </Field>
          <Field>
            <FieldLabel htmlFor="op-prospect">Prospect</FieldLabel>
            <ProspectPicker id="op-prospect" value={picked} onChange={(p) => { setPicked(p); if (p && !v.company) setV({ ...v, company: p.company ?? "" }); }} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="op-company">Company</FieldLabel>
              <Input id="op-company" value={v.company} onChange={set("company")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="op-service">Service</FieldLabel>
              <Input id="op-service" value={v.serviceType} onChange={set("serviceType")} placeholder="Landing page + Framer build" />
            </Field>
            <Field>
              <FieldLabel htmlFor="op-value">Estimated value</FieldLabel>
              <div className="flex gap-2">
                <Input id="op-value" type="number" min={0} step="100" value={v.value} onChange={set("value")} />
                <Input aria-label="Currency" className="w-20" maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="op-close">Expected close</FieldLabel>
              <Input id="op-close" type="date" value={v.expectedCloseDate} onChange={set("expectedCloseDate")} />
            </Field>
            <Field>
              <FieldLabel>Stage</FieldLabel>
              <Select value={v.stage} onValueChange={(x) => setV({ ...v, stage: x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Primary source</FieldLabel>
              <Select value={v.sourceChannel} onValueChange={(x) => setV({ ...v, sourceChannel: x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {Object.entries(SOURCE_CHANNEL_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {campaigns.length > 0 && (
              <Field>
                <FieldLabel>Outreach campaign</FieldLabel>
                <Select value={v.outreachCampaignId} onValueChange={(x) => setV({ ...v, outreachCampaignId: x })}>
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
            {content && content.length > 0 && (
              <Field>
                <FieldLabel>Related post</FieldLabel>
                <Select value={v.contentItemId} onValueChange={(x) => setV({ ...v, contentItemId: x })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {content.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field>
              <FieldLabel htmlFor="op-next">Next action</FieldLabel>
              <Input id="op-next" value={v.nextAction} onChange={set("nextAction")} placeholder="Send proposal" />
            </Field>
            <Field>
              <FieldLabel htmlFor="op-next-at">By</FieldLabel>
              <Input id="op-next-at" type="datetime-local" value={v.nextActionAt} onChange={set("nextActionAt")} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="op-notes">Notes & outcome</FieldLabel>
            <Textarea id="op-notes" rows={3} value={v.outcomeNotes} onChange={set("outcomeNotes")} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !v.name.trim()}>
            {pending && <Spinner />} {o ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
