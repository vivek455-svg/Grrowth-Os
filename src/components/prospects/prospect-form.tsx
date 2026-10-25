"use client";

import { useState } from "react";
import type React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { createProspect, updateProspect } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import type { Prospect } from "@/db/schema";
import type { DuplicateMatch } from "@/lib/domain/outreach-rules";

const url = z
  .string()
  .trim()
  .refine((v) => !v || /^https?:\/\/\S+\.\S+/i.test(v), "Use a full URL starting with https://");

const schema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200),
  jobTitle: z.string(),
  company: z.string(),
  companyWebsite: url,
  linkedinUrl: url,
  xUrl: url,
  email: z.string().trim().refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email"),
  location: z.string(),
  companyType: z.string(),
  industry: z.string(),
  companySize: z.string(),
  source: z.string(),
  persona: z.string(),
  relevantServices: z.string(),
  websiteUrl: url,
  businessProblem: z.string(),
  personalizationNotes: z.string(),
  fitScore: z.string().refine((v) => !v || (/^\d+$/.test(v) && Number(v) <= 100), "0–100"),
  fitExplanation: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  status: z.string(),
  preferredChannel: z.string(),
  tags: z.string(),
});
type Values = z.infer<typeof schema>;

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function toValues(p?: Prospect | null): Values {
  return {
    fullName: p?.fullName ?? "",
    jobTitle: p?.jobTitle ?? "",
    company: p?.company ?? "",
    companyWebsite: p?.companyWebsite ?? "",
    linkedinUrl: p?.linkedinUrl ?? "",
    xUrl: p?.xUrl ?? "",
    email: p?.email ?? "",
    location: p?.location ?? "",
    companyType: p?.companyType ?? "",
    industry: p?.industry ?? "",
    companySize: p?.companySize ?? "",
    source: p?.source ?? "",
    persona: p?.persona ?? "",
    relevantServices: p?.relevantServices.join(", ") ?? "",
    websiteUrl: p?.websiteUrl ?? "",
    businessProblem: p?.businessProblem ?? "",
    personalizationNotes: p?.personalizationNotes ?? "",
    fitScore: p?.fitScore?.toString() ?? "",
    fitExplanation: p?.fitExplanation ?? "",
    priority: p?.priority ?? "medium",
    status: p?.status ?? "new",
    preferredChannel: p?.preferredChannel ?? "none",
    tags: p?.tags.join(", ") ?? "",
  };
}

function toInput(v: Values) {
  return {
    ...v,
    relevantServices: list(v.relevantServices),
    tags: list(v.tags.toLowerCase()),
    preferredChannel: v.preferredChannel === "none" ? null : (v.preferredChannel as "email" | "linkedin" | "x"),
    fitScore: v.fitScore || null,
  };
}

export function ProspectForm({
  prospect,
  statuses,
  onDone,
  formId,
  compact,
  footer,
}: {
  prospect?: Prospect | null;
  statuses: { key: string; label: string }[];
  onDone?: (id: string) => void;
  formId: string;
  compact?: boolean;
  footer?: (pending: boolean) => React.ReactNode;
}) {
  const { run, pending } = useAction();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(prospect) });
  const e = form.formState.errors;

  function submit(v: Values, allowDuplicate = false) {
    if (prospect) {
      run(() => updateProspect({ id: prospect.id, ...toInput(v) }), { success: "Prospect saved", onSuccess: () => onDone?.(prospect.id) });
      return;
    }
    run(() => createProspect({ ...toInput(v), allowDuplicate }), {
      onSuccess: (data) => {
        if (data.id) {
          toast.success("Prospect added");
          onDone?.(data.id);
        } else setDuplicates(data.duplicates);
      },
    });
  }

  const text = (name: keyof Values, label: string, placeholder?: string, type = "text") => (
    <Field data-invalid={!!e[name]}>
      <FieldLabel htmlFor={`${formId}-${name}`}>{label}</FieldLabel>
      <Input id={`${formId}-${name}`} type={type} placeholder={placeholder} aria-invalid={!!e[name]} {...form.register(name)} />
      <FieldError errors={[e[name]]} />
    </Field>
  );

  return (
    <form id={formId} onSubmit={form.handleSubmit((v) => submit(v))} className="space-y-5">
      {duplicates.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Possible duplicate</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/prospects/${d.id}`} className="font-medium underline underline-offset-2">
                    {d.fullName}
                  </Link>{" "}
                  matches by {d.reason === "name_domain" ? "name and website" : d.reason}.
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={form.handleSubmit((v) => submit(v, true))}>
              Add anyway
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <FieldSet>
        <FieldLegend variant="label">Person</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {text("fullName", "Full name")}
          {text("jobTitle", "Job title", "Founder, Head of Marketing…")}
          {text("email", "Work email", "Only if publicly listed or shared with you", "email")}
          {text("location", "Location")}
          {text("linkedinUrl", "LinkedIn profile URL", "https://www.linkedin.com/in/…")}
          {text("xUrl", "X profile URL", "https://x.com/…")}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Company</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {text("company", "Company")}
          {text("companyWebsite", "Company website", "https://")}
          {text("companyType", "Company type", "B2B SaaS, Design agency…")}
          {text("industry", "Industry")}
          {!compact && text("companySize", "Company size", "1–10, 11–50…")}
          {!compact && text("websiteUrl", "Website URL to evaluate", "Landing page you'd review")}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Qualification</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Status</FieldLabel>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field>
            <FieldLabel>Priority</FieldLabel>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field>
            <FieldLabel>Preferred channel</FieldLabel>
            <Controller
              control={form.control}
              name="preferredChannel"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="x">X</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {text("fitScore", "Fit score (0–100)", "Your judgement", "number")}
          {text("persona", "Target persona", "Founder, Marketing lead, Agency owner…")}
          {text("source", "Source", "Referral, LinkedIn post, CSV…")}
          {text("relevantServices", "Relevant services", "Comma separated")}
          {text("tags", "Tags", "Comma separated")}
        </FieldGroup>
      </FieldSet>
      {!compact && (
        <FieldSet>
          <FieldLegend variant="label">Notes</FieldLegend>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${formId}-fitExplanation`}>Fit-score explanation</FieldLabel>
              <Textarea id={`${formId}-fitExplanation`} rows={2} {...form.register("fitExplanation")} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-businessProblem`}>Potential business problem</FieldLabel>
              <Textarea id={`${formId}-businessProblem`} rows={2} placeholder="Only what you can support with evidence" {...form.register("businessProblem")} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-personalizationNotes`}>Personalization notes</FieldLabel>
              <Textarea id={`${formId}-personalizationNotes`} rows={3} {...form.register("personalizationNotes")} />
            </Field>
          </FieldGroup>
        </FieldSet>
      )}
      {footer?.(pending)}
    </form>
  );
}

export function ProspectFormDialog({
  open,
  onOpenChange,
  statuses,
  prospect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: { key: string; label: string }[];
  prospect?: Prospect | null;
}) {
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prospect ? "Edit prospect" : "Add prospect"}</DialogTitle>
          <DialogDescription>
            Add only details you found through legitimate sources. Duplicates are checked by email, LinkedIn profile, and website.
          </DialogDescription>
        </DialogHeader>
        <ProspectForm
          formId="prospect-dialog"
          prospect={prospect}
          statuses={statuses}
          compact={!prospect}
          onDone={(id) => {
            onOpenChange(false);
            if (!prospect) router.push(`/prospects/${id}`);
            else router.refresh();
          }}
          footer={(pending) => (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />} {prospect ? "Save changes" : "Add prospect"}
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
