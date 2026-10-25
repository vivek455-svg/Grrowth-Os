"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { createContent } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import { FORMAT_LABEL } from "@/lib/labels";
import { toLocalInput } from "@/lib/format";

const schema = z
  .object({
    title: z.string().trim().min(1, "Give the post an internal label").max(200),
    platforms: z.array(z.enum(["x", "linkedin"])).min(1, "Choose at least one platform"),
    format: z.enum(["text", "image", "carousel", "video", "link", "thread"]),
    pillarId: z.string(),
    status: z.enum(["idea", "draft", "ready", "scheduled"]),
    plannedAt: z.string(),
    body: z.string().max(25000),
  })
  .refine((v) => v.status !== "scheduled" || v.plannedAt, { message: "Scheduled posts need a date", path: ["plannedAt"] });

type Values = z.infer<typeof schema>;

export function NewPostDialog({
  open,
  onOpenChange,
  defaults,
  pillars,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: { plannedAt?: Date; title?: string; body?: string; ideaId?: string; pillarId?: string | null };
  pillars: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: defaults.title ?? "",
      platforms: ["linkedin"],
      format: "text",
      pillarId: defaults.pillarId ?? "none",
      status: defaults.plannedAt ? "scheduled" : "draft",
      plannedAt: defaults.plannedAt ? toLocalInput(defaults.plannedAt) : "",
      body: defaults.body ?? "",
    },
  });

  function submit(v: Values) {
    run(
      () =>
        createContent({
          ...v,
          pillarId: v.pillarId === "none" ? null : v.pillarId,
          plannedAt: v.plannedAt ? new Date(v.plannedAt) : null,
          ideaId: defaults.ideaId ?? null,
        }),
      {
        onSuccess: (data) => {
          onOpenChange(false);
          toast.success("Post created", { action: { label: "Open", onClick: () => router.push(`/content/${data.id}`) } });
        },
      },
    );
  }

  const errors = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
          <DialogDescription>Create one idea with a version per platform. Nothing is published from here.</DialogDescription>
        </DialogHeader>
        <form id="new-post" onSubmit={form.handleSubmit(submit)}>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor="np-title">Internal label</FieldLabel>
              <Input id="np-title" placeholder="e.g. Pricing page teardown — Linear" aria-invalid={!!errors.title} {...form.register("title")} />
              <FieldError errors={[errors.title]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.platforms}>
                <FieldLabel>Platforms</FieldLabel>
                <Controller
                  control={form.control}
                  name="platforms"
                  render={({ field }) => (
                    <ToggleGroup type="multiple" variant="outline" value={field.value} onValueChange={field.onChange} className="w-full">
                      <ToggleGroupItem value="linkedin" className="flex-1">LinkedIn</ToggleGroupItem>
                      <ToggleGroupItem value="x" className="flex-1">X</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
                <FieldError errors={[errors.platforms]} />
              </Field>
              <Field>
                <FieldLabel>Format</FieldLabel>
                <Controller
                  control={form.control}
                  name="format"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FORMAT_LABEL).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Content pillar</FieldLabel>
                <Controller
                  control={form.control}
                  name="pillarId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No pillar</SelectItem>
                        {pillars.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="idea">Idea</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="ready">Ready</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
            <Field data-invalid={!!errors.plannedAt}>
              <FieldLabel htmlFor="np-date">Planned date & time</FieldLabel>
              <Input id="np-date" type="datetime-local" aria-invalid={!!errors.plannedAt} {...form.register("plannedAt")} />
              <FieldError errors={[errors.plannedAt]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="np-body">Draft</FieldLabel>
              <Textarea id="np-body" rows={5} placeholder="Start writing, or leave empty and draft later." {...form.register("body")} />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="new-post" disabled={pending}>
            {pending && <Spinner />} Create post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
