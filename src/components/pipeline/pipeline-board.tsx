"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, KanbanSquare, List, Pencil, Plus, Settings2, Trash2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { OpportunityDialog } from "./opportunity-dialog";
import { addPipelineStage, addTouchpoint, deleteOpportunity, deleteStage, moveOpportunity, removeTouchpoint, renameStage } from "@/server/actions/pipeline";
import { useAction } from "@/hooks/use-action";
import { fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { SOURCE_CHANNEL_LABEL } from "@/lib/labels";
import type { Opportunity, SourceChannel } from "@/db/schema";
import { cn } from "@/lib/utils";

type Stage = { key: string; label: string; kind: "open" | "won" | "lost"; sortOrder: number };
type Row = { o: Opportunity; prospectName: string | null; campaign: string | null; content: string | null };
type Touch = { t: { id: string; opportunityId: string; kind: SourceChannel; note: string | null }; content: string | null; campaign: string | null };

function StagesDialog({ stages, open, onOpenChange }: { stages: Stage[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending } = useAction();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"open" | "won" | "lost">("open");
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>Rename, add or remove stages. A stage can be removed once it has no opportunities.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <Input value={edits[s.key] ?? s.label} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} aria-label={`Stage ${s.label}`} />
              <Badge variant="outline" className="shrink-0 font-normal">{s.kind}</Badge>
              {edits[s.key] !== undefined && edits[s.key] !== s.label && (
                <Button size="xs" disabled={pending} onClick={() => run(() => renameStage({ key: s.key, label: edits[s.key]! }), { success: "Renamed" })}>Save</Button>
              )}
              <Button size="icon-xs" variant="ghost" aria-label={`Delete ${s.label}`} disabled={pending} onClick={() => run(() => deleteStage({ key: s.key }), { success: "Stage removed" })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 border-t pt-3">
          <Input placeholder="New stage" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="New stage name" />
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={!label.trim() || pending} onClick={() => run(() => addPipelineStage({ label, kind }), { success: "Stage added", onSuccess: () => setLabel("") })}>
            <Plus /> Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailSheet({
  row,
  stages,
  touches,
  campaigns,
  content,
  onClose,
  onEdit,
}: {
  row: Row;
  stages: Stage[];
  touches: Touch[];
  campaigns: { id: string; name: string }[];
  content: { id: string; title: string }[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [kind, setKind] = useState<SourceChannel>("content");
  const [ref, setRef] = useState("none");
  const [note, setNote] = useState("");
  const [del, setDel] = useState(false);
  const o = row.o;
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{o.name}</SheetTitle>
          <SheetDescription>{[o.company, o.serviceType].filter(Boolean).join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Stage</p>
              <Select value={o.stage} onValueChange={(v) => run(() => moveOpportunity({ id: o.id, stage: v }), { success: "Stage updated" })}>
                <SelectTrigger size="sm" className="mt-1 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimated value</p>
              <p className="num mt-1.5 font-medium">{fmtMoney(o.valueCents, o.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Expected close</p>
              <p>{fmtDate(o.expectedCloseDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last activity</p>
              <p>{fmtRelative(o.lastActivityAt ?? o.createdAt)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Prospect</p>
              {o.prospectId ? <Link className="hover:underline" href={`/prospects/${o.prospectId}`}>{row.prospectName}</Link> : <p>—</p>}
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Next action</p>
              <p>{o.nextAction ?? "—"}{o.nextActionAt ? ` · by ${fmtDate(o.nextActionAt)}` : ""}</p>
            </div>
            {o.outcomeNotes && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="whitespace-pre-line">{o.outcomeNotes}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Attribution touchpoints</p>
            <p className="text-xs text-muted-foreground">What contributed to this opportunity. Several touchpoints can share credit; this records attribution, not proven causation.</p>
            <ul className="space-y-1.5">
              {touches.map(({ t, content: c, campaign }) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="shrink-0 font-normal">{SOURCE_CHANNEL_LABEL[t.kind]}</Badge>
                  <span className="min-w-0 flex-1">{c ?? campaign ?? t.note ?? "—"}{(c || campaign) && t.note ? <span className="block text-xs text-muted-foreground">{t.note}</span> : null}</span>
                  <Button size="icon-xs" variant="ghost" aria-label="Remove touchpoint" onClick={() => run(() => removeTouchpoint({ id: t.id }))}>
                    <XIcon />
                  </Button>
                </li>
              ))}
              {touches.length === 0 && <li className="text-sm text-muted-foreground">None recorded.</li>}
            </ul>
            <div className="space-y-2 rounded-md border p-2.5">
              <div className="flex gap-2">
                <Select value={kind} onValueChange={(v) => { setKind(v as SourceChannel); setRef("none"); }}>
                  <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_CHANNEL_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(kind === "content" || kind === "outreach") && (
                  <Select value={ref} onValueChange={setRef}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{kind === "content" ? "Choose a post" : "Choose a campaign"}</SelectItem>
                      {(kind === "content" ? content.map((c) => ({ id: c.id, name: c.title })) : campaigns).map((x) => (
                        <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Input placeholder="Note (e.g. mentioned the teardown post on the call)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8" aria-label="Touchpoint note" />
              <Button
                size="xs"
                disabled={pending || ((kind === "content" || kind === "outreach") && ref === "none" && !note.trim())}
                onClick={() =>
                  run(
                    () =>
                      addTouchpoint({
                        opportunityId: o.id,
                        kind,
                        contentItemId: kind === "content" && ref !== "none" ? ref : null,
                        outreachCampaignId: kind === "outreach" && ref !== "none" ? ref : null,
                        note,
                      }),
                    { success: "Touchpoint added", onSuccess: () => { setNote(""); setRef("none"); } },
                  )
                }
              >
                <Plus /> Add touchpoint
              </Button>
            </div>
          </div>

          <div className="flex gap-2 border-t pt-4">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDel(true)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
        <AlertDialog open={del} onOpenChange={setDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this opportunity?</AlertDialogTitle>
              <AlertDialogDescription>It will be removed from pipeline and revenue reports. Move it to “Lost” instead to keep the history.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => run(() => deleteOpportunity({ id: o.id }), { success: "Deleted", onSuccess: () => { onClose(); router.refresh(); } })}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

export function PipelineBoard({
  stages,
  rows,
  touchpoints,
  campaigns,
  content,
}: {
  stages: Stage[];
  rows: Row[];
  touchpoints: Touch[];
  campaigns: { id: string; name: string }[];
  content: { id: string; title: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<"board" | "table">("board");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  useEffect(() => setOptimistic({}), [rows]);

  const stageOf = (r: Row) => optimistic[r.o.id] ?? r.o.stage;
  const byStage = useMemo(() => new Map(stages.map((s) => [s.key, rows.filter((r) => stageOf(r) === s.key)])), [stages, rows, optimistic]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = rows.find((r) => r.o.id === openId);

  function drop(stage: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/opportunity");
    const row = rows.find((r) => r.o.id === id);
    if (!row || stageOf(row) === stage) return;
    setOptimistic({ ...optimistic, [id]: stage });
    start(async () => {
      const res = await moveOpportunity({ id, stage });
      if (!res.ok) {
        toast.error(res.error);
        setOptimistic((o) => {
          const n = { ...o };
          delete n[id];
          return n;
        });
      } else toast.success(`Moved to ${stages.find((s) => s.key === stage)?.label}`);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as "board" | "table")} aria-label="Layout">
          <ToggleGroupItem value="board"><KanbanSquare /> Board</ToggleGroupItem>
          <ToggleGroupItem value="table"><List /> Table</ToggleGroupItem>
        </ToggleGroup>
        <Button size="sm" variant="ghost" onClick={() => setStagesOpen(true)}>
          <Settings2 /> Stages
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(stages[0]?.key ?? "qualified")}>
          <Plus /> New opportunity
        </Button>
      </div>

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3">
            {stages.map((s) => {
              const list = byStage.get(s.key) ?? [];
              const total = list.reduce((acc, r) => (r.o.currency === "USD" ? acc + (r.o.valueCents ?? 0) : acc), 0);
              return (
                <div
                  key={s.key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(s.key);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === s.key ? null : d))}
                  onDrop={(e) => drop(s.key, e)}
                  className={cn("flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition-colors", dragOver === s.key && "bg-info-soft")}
                >
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="num text-xs text-muted-foreground">{list.length}{total ? ` · ${fmtMoney(total)}` : ""}</span>
                  </div>
                  {list.map((r) => (
                    <button
                      key={r.o.id}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/opportunity", r.o.id)}
                      onClick={() => setOpenId(r.o.id)}
                      className="space-y-1.5 rounded-md border bg-card p-2.5 text-left transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <p className="text-sm leading-snug font-medium">{r.o.name}</p>
                      <p className="text-xs text-muted-foreground">{r.prospectName ?? r.o.company ?? "—"}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="num font-medium">{fmtMoney(r.o.valueCents, r.o.currency)}</span>
                        {r.o.sourceChannel && <Badge variant="outline" className="font-normal">{SOURCE_CHANNEL_LABEL[r.o.sourceChannel]}</Badge>}
                      </div>
                      {r.o.nextAction && s.kind === "open" && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="size-3" /> {r.o.nextAction}
                        </p>
                      )}
                    </button>
                  ))}
                  <Button size="xs" variant="ghost" className="justify-start text-muted-foreground" onClick={() => setCreating(s.key)}>
                    <Plus /> Add
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Opportunity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell">Expected close</TableHead>
                <TableHead className="hidden lg:table-cell">Next action</TableHead>
                <TableHead className="hidden lg:table-cell pr-4">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.o.id} className="cursor-pointer" onClick={() => setOpenId(r.o.id)}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{r.o.name}</p>
                    <p className="text-xs text-muted-foreground">{r.prospectName ?? r.o.company}</p>
                  </TableCell>
                  <TableCell>{stages.find((s) => s.key === r.o.stage)?.label}</TableCell>
                  <TableCell className="num text-right">{fmtMoney(r.o.valueCents, r.o.currency)}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.o.sourceChannel ? SOURCE_CHANNEL_LABEL[r.o.sourceChannel] : "—"}</TableCell>
                  <TableCell className="num hidden md:table-cell">{fmtDate(r.o.expectedCloseDate)}</TableCell>
                  <TableCell className="hidden max-w-48 truncate lg:table-cell">{r.o.nextAction ?? "—"}</TableCell>
                  <TableCell className="num hidden pr-4 text-muted-foreground lg:table-cell">{fmtRelative(r.o.lastActivityAt ?? r.o.createdAt)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No opportunities yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {open && (
        <DetailSheet
          row={open}
          stages={stages}
          touches={touchpoints.filter((t) => t.t.opportunityId === open.o.id)}
          campaigns={campaigns}
          content={content}
          onClose={() => {
            setOpenId(null);
            router.replace("/opportunities", { scroll: false });
          }}
          onEdit={() => setEditing(open.o)}
        />
      )}
      {(editing || creating) && (
        <OpportunityDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditing(null);
              setCreating(null);
            }
          }}
          stages={stages}
          campaigns={campaigns}
          content={content}
          opportunity={editing}
          prospect={editing?.prospectId ? { id: editing.prospectId, name: rows.find((r) => r.o.id === editing.id)?.prospectName ?? "", company: editing.company } : null}
          defaultStage={creating ?? undefined}
        />
      )}
      <StagesDialog stages={stages} open={stagesOpen} onOpenChange={setStagesOpen} />
    </div>
  );
}
