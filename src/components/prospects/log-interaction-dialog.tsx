"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ProspectPicker, type PickedProspect } from "@/components/app/prospect-picker";
import { logInteraction } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import { EVENT_LABEL, LOGGABLE_EVENTS } from "@/lib/labels";
import { toLocalInput } from "@/lib/format";
import type { EventType } from "@/db/schema";

const schema = z.object({
  type: z.string().min(1),
  occurredAt: z.string().min(1, "When did it happen?"),
  content: z.string().max(20000),
  notes: z.string().max(5000),
  sentiment: z.string(),
  campaignId: z.string(),
  followUpAt: z.string(),
});
type Values = z.infer<typeof schema>;

export function LogInteractionDialog({
  open,
  onOpenChange,
  prospect,
  campaigns,
  defaultType,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prospect?: PickedProspect;
  campaigns: { id: string; name: string }[];
  defaultType?: EventType;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [picked, setPicked] = useState<PickedProspect | null>(prospect ?? null);
  const [pickError, setPickError] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: defaultType ?? "email_sent",
      occurredAt: toLocalInput(new Date()),
      content: "",
      notes: "",
      sentiment: "none",
      campaignId: "none",
      followUpAt: "",
    },
  });
  const type = useWatch({ control: form.control, name: "type" }) as EventType;
  const direction = LOGGABLE_EVENTS.find((e) => e.type === type)?.direction;

  function submit(v: Values) {
    if (!picked) {
      setPickError(true);
      return;
    }
    run(
      () =>
        logInteraction({
          prospectId: picked.id,
          type: v.type as EventType,
          occurredAt: new Date(v.occurredAt),
          content: v.content,
          notes: v.notes,
          sentiment: direction === "inbound" && v.sentiment !== "none" ? (v.sentiment as "positive") : null,
          campaignId: v.campaignId === "none" ? null : v.campaignId,
          followUpAt: v.followUpAt ? new Date(v.followUpAt) : null,
        }),
      {
        success: "Interaction logged",
        onSuccess: () => {
          onOpenChange(false);
          router.refresh();
        },
      },
    );
  }

  const groups: { label: string; dir: string }[] = [
    { label: "Outgoing", dir: "outbound" },
    { label: "Incoming", dir: "inbound" },
    { label: "Other", dir: "internal" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log interaction</DialogTitle>
          <DialogDescription>Record something that happened outside the app. It is marked as manually logged on the timeline.</DialogDescription>
        </DialogHeader>
        <form id="log-interaction" onSubmit={form.handleSubmit(submit)}>
          <FieldGroup className="gap-4">
            {!prospect && (
              <Field data-invalid={pickError}>
                <FieldLabel htmlFor="li-prospect">Prospect</FieldLabel>
                <ProspectPicker id="li-prospect" value={picked} onChange={(p) => { setPicked(p); setPickError(false); }} invalid={pickError} />
                {pickError && <FieldError>Choose who this interaction was with.</FieldError>}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => (
                          <SelectGroup key={g.dir}>
                            <SelectLabel>{g.label}</SelectLabel>
                            {LOGGABLE_EVENTS.filter((e) => e.direction === g.dir).map((e) => (
                              <SelectItem key={e.type} value={e.type}>{EVENT_LABEL[e.type]}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field data-invalid={!!form.formState.errors.occurredAt}>
                <FieldLabel htmlFor="li-when">When</FieldLabel>
                <Input id="li-when" type="datetime-local" {...form.register("occurredAt")} />
                <FieldError errors={[form.formState.errors.occurredAt]} />
              </Field>
            </div>
            {direction === "inbound" && (
              <Field>
                <FieldLabel>Reply classification</FieldLabel>
                <Controller
                  control={form.control}
                  name="sentiment"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        <SelectItem value="positive">Positive — interested or open to talk</SelectItem>
                        <SelectItem value="neutral">Neutral — question or not now</SelectItem>
                        <SelectItem value="negative">Negative — not interested</SelectItem>
                        <SelectItem value="opt_out">Opt-out — asked not to be contacted</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>Used for positive-reply rate. Opt-outs are added to the suppression list.</FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="li-content">{type === "note" ? "Note" : "Message content"}</FieldLabel>
              <Textarea id="li-content" rows={4} placeholder={type === "note" ? "" : "Paste the message, if you want it on the timeline"} {...form.register("content")} />
            </Field>
            {campaigns.length > 0 && direction !== "internal" && (
              <Field>
                <FieldLabel>Campaign</FieldLabel>
                <Controller
                  control={form.control}
                  name="campaignId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No campaign</SelectItem>
                        {campaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}
            {direction === "outbound" && (
              <Field>
                <FieldLabel htmlFor="li-fu">Schedule a follow-up (optional)</FieldLabel>
                <Input id="li-fu" type="datetime-local" {...form.register("followUpAt")} />
              </Field>
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="log-interaction" disabled={pending}>
            {pending && <Spinner />} Log interaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
