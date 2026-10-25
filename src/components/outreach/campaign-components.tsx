"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, Pencil, Plus, Trash2, UserPlus, X as XIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ProspectPicker, type PickedProspect } from "@/components/app/prospect-picker";
import { addToCampaign, deleteCampaign, removeFromCampaign, saveCampaign } from "@/server/actions/pipeline";
import { approveMessage } from "@/server/actions/sending";
import { useAction } from "@/hooks/use-action";
import type { OutreachCampaign } from "@/db/schema";

export function CampaignDialog({ campaign, open, onOpenChange }: { campaign?: OutreachCampaign | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const c = campaign;
  const [v, setV] = useState({
    name: c?.name ?? "",
    description: c?.description ?? "",
    targetAudience: c?.targetAudience ?? "",
    criteria: c?.criteria ?? "",
    channel: c?.channel ?? "email",
    messageStrategy: c?.messageStrategy ?? "",
    startDate: c?.startDate ?? "",
    endDate: c?.endDate ?? "",
    status: c?.status ?? "draft",
  });
  const text = (k: keyof typeof v, label: string, area = false, placeholder = "") => (
    <Field>
      <FieldLabel htmlFor={`cmp-${k}`}>{label}</FieldLabel>
      {area ? (
        <Textarea id={`cmp-${k}`} rows={2} value={v[k]} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      ) : (
        <Input id={`cmp-${k}`} value={v[k]} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} type={k.endsWith("Date") ? "date" : "text"} />
      )}
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{c ? "Edit campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>A campaign groups prospects and a message strategy. Adding prospects never sends anything.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          {text("name", "Name", false, "SaaS landing page outreach")}
          {text("description", "Description", true)}
          {text("targetAudience", "Target audience", false, "Seed–Series A B2B SaaS founders")}
          {text("criteria", "Prospect criteria", true, "What qualifies someone for this campaign")}
          {text("messageStrategy", "Message strategy", true, "The angle, tone and offer. Used by the AI when drafting.")}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Channel</FieldLabel>
              <Select value={v.channel} onValueChange={(x) => setV({ ...v, channel: x as typeof v.channel })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="x">X</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={v.status} onValueChange={(x) => setV({ ...v, status: x as typeof v.status })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {text("startDate", "Start date")}
            {text("endDate", "End date")}
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || !v.name.trim()}
            onClick={() =>
              run(() => saveCampaign({ id: c?.id, ...v }), {
                success: c ? "Campaign saved" : "Campaign created",
                onSuccess: (d) => {
                  onOpenChange(false);
                  if (!c) router.push(`/campaigns/${d.id}`);
                  else router.refresh();
                },
              })
            }
          >
            {pending && <Spinner />} {c ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewCampaignButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New campaign
      </Button>
      {open && <CampaignDialog open onOpenChange={setOpen} />}
    </>
  );
}

export function CampaignActions({ campaign }: { campaign: OutreachCampaign }) {
  const router = useRouter();
  const { run } = useAction();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [add, setAdd] = useState(false);
  const [picked, setPicked] = useState<PickedProspect | null>(null);
  const [ignoreCooldown, setIgnoreCooldown] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAdd(true)}>
        <UserPlus /> Add prospect
      </Button>
      <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
        <Pencil /> Edit
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Delete campaign" onClick={() => setDel(true)}>
        <Trash2 />
      </Button>
      {edit && <CampaignDialog campaign={campaign} open onOpenChange={setEdit} />}
      <Dialog open={add} onOpenChange={setAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a prospect</DialogTitle>
            <DialogDescription>To add many at once, select them on the Prospects page and use “Add to campaign”.</DialogDescription>
          </DialogHeader>
          <ProspectPicker value={picked} onChange={setPicked} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ignoreCooldown} onChange={(e) => setIgnoreCooldown(e.target.checked)} className="size-4 accent-current" />
            Allow even if contacted within the cooldown period
          </label>
          <DialogFooter>
            <Button
              disabled={!picked}
              onClick={() =>
                run(() => addToCampaign({ campaignId: campaign.id, prospectIds: [picked!.id], ignoreCooldown }), {
                  success: (d) => (d.added ? "Added to campaign" : `Not added: ${d.skipped[0]?.reason ?? "skipped"}`),
                  onSuccess: () => {
                    setAdd(false);
                    setPicked(null);
                  },
                })
              }
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{campaign.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Prospects and their history are kept; they're just removed from this campaign.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => run(() => deleteCampaign({ id: campaign.id }), { success: "Campaign deleted", onSuccess: () => router.push("/campaigns") })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MemberActions({ campaignId, prospectId, channel }: { campaignId: string; prospectId: string; channel: string }) {
  const { run, pending } = useAction();
  return (
    <div className="flex justify-end gap-1">
      <Button asChild size="xs" variant="outline">
        <Link href={`/outreach/compose?prospect=${prospectId}&campaign=${campaignId}${channel !== "mixed" ? `&channel=${channel}` : ""}`}>
          <MessageSquarePlus /> Draft
        </Link>
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Remove from campaign" disabled={pending} onClick={() => run(() => removeFromCampaign({ campaignId, prospectId }), { success: "Removed" })}>
        <XIcon />
      </Button>
    </div>
  );
}

export function ApproveButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  return (
    <Button size="xs" disabled={pending} onClick={() => run(() => approveMessage({ id }), { success: "Approved" })}>
      <Check /> Approve
    </Button>
  );
}

const activityConfig = { sent: { label: "Sent", color: "var(--chart-1)" }, replies: { label: "Replies", color: "var(--chart-2)" } } satisfies ChartConfig;

export function CampaignActivityChart({ data }: { data: { day: string; sent: number; replies: number }[] }) {
  return (
    <ChartContainer config={activityConfig} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickFormatter={(v) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar isAnimationActive={false} dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar isAnimationActive={false} dataKey="replies" fill="var(--color-replies)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}
