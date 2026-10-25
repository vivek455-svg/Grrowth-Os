"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Bookmark, ChevronDown, Download, Megaphone, Search, Tag, Trash2, Upload, UserPlus, Users, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FitScore, LeadStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { ParamSelect, useSetParams } from "@/components/analytics/range-filter";
import { useShell } from "@/components/app/shell-context";
import { bulkUpdateProspects, deleteView, saveView } from "@/server/actions/prospects";
import { addToCampaign } from "@/server/actions/pipeline";
import { useAction } from "@/hooks/use-action";
import { fmtDate, fmtRelative, hostname } from "@/lib/format";
import { CHANNEL_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import type { Channel, Priority } from "@/db/schema";
import { cn } from "@/lib/utils";

export type ProspectRow = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  company: string | null;
  companyWebsite: string | null;
  companyType: string | null;
  status: string;
  priority: Priority;
  fitScore: number | null;
  preferredChannel: Channel | null;
  tags: string[];
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  campaigns: string[];
  duplicateOf: string | null;
};

type Options = {
  statuses: { key: string; label: string; category: string }[];
  tags: string[];
  companyTypes: string[];
  campaigns: { id: string; name: string }[];
  views: { id: string; name: string; filters: Record<string, string> }[];
  builtin: { key: string; name: string; filters: Record<string, string> }[];
};

const FILTER_KEYS = ["q", "status", "priority", "channel", "companyType", "persona", "tag", "fitMin", "campaign", "uncontacted", "due", "positive", "hasOpp"];

function SearchBox() {
  const params = useSearchParams();
  const set = useSetParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q: q || null });
    }, 250);
    return () => clearTimeout(t);
  });
  return (
    <InputGroup className="w-full sm:w-64">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="Name, company, email, title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prospects" />
    </InputGroup>
  );
}

function ViewsMenu({ options, activeName }: { options: Options; activeName: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const { run } = useAction();
  const [name, setName] = useState("");
  const current = Object.fromEntries(FILTER_KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k)!]));
  const go = (filters: Record<string, string>, label: string) => {
    const sp = new URLSearchParams({ ...filters, viewName: label });
    router.push(`/prospects?${sp}`);
  };
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark /> {activeName ?? "Views"} <ChevronDown className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onSelect={() => router.push("/prospects")}>All prospects</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Built-in</DropdownMenuLabel>
          {options.builtin.map((v) => (
            <DropdownMenuItem key={v.key} onSelect={() => go(v.filters, v.name)}>
              {v.name}
            </DropdownMenuItem>
          ))}
          {options.views.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Saved</DropdownMenuLabel>
              {options.views.map((v) => (
                <DropdownMenuSub key={v.id}>
                  <DropdownMenuSubTrigger>{v.name}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => go(v.filters, v.name)}>Open</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => run(() => deleteView({ id: v.id }), { success: "View deleted" })}>
                      Delete view
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {Object.keys(current).length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">Save view</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <Input placeholder="View name" value={name} onChange={(e) => setName(e.target.value)} aria-label="View name" />
            <Button
              size="sm"
              className="w-full"
              disabled={!name.trim()}
              onClick={() => run(() => saveView({ name, entity: "prospects", filters: current }), { success: "View saved", onSuccess: () => setName("") })}
            >
              Save current filters
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function BulkBar({ ids, options, onDone }: { ids: string[]; options: Options; onDone: () => void }) {
  const { run, pending } = useAction();
  const [tag, setTag] = useState("");
  const [confirm, setConfirm] = useState(false);
  const bulk = (op: Parameters<typeof bulkUpdateProspects>[0]["op"], msg: string) =>
    run(() => bulkUpdateProspects({ ids, op }), { success: (d) => `${msg} (${d.affected})`, onSuccess: onDone });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="outline" disabled={pending}>Set status</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {options.statuses.map((s) => (
            <DropdownMenuItem key={s.key} onSelect={() => bulk({ kind: "status", status: s.key }, `Status set to ${s.label}`)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="outline" disabled={pending}>Priority</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(["high", "medium", "low"] as const).map((p) => (
            <DropdownMenuItem key={p} onSelect={() => bulk({ kind: "priority", priority: p }, `Priority set to ${PRIORITY_LABEL[p]}`)}>
              {PRIORITY_LABEL[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="xs" variant="outline" disabled={pending}>
            <Tag /> Tags
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60 space-y-2">
          <Input placeholder="tag" value={tag} onChange={(e) => setTag(e.target.value.toLowerCase())} list="known-tags" aria-label="Tag" />
          <datalist id="known-tags">
            {options.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={!tag.trim()} onClick={() => bulk({ kind: "add_tag", tag }, `Tagged “${tag}”`)}>
              Add
            </Button>
            <Button size="sm" variant="outline" className="flex-1" disabled={!tag.trim()} onClick={() => bulk({ kind: "remove_tag", tag }, `Removed “${tag}”`)}>
              Remove
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {options.campaigns.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending}>
              <Megaphone /> Add to campaign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel className="max-w-56 text-xs font-normal text-muted-foreground">Queues them for review. Nothing is sent.</DropdownMenuLabel>
            {options.campaigns.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() =>
                  run(() => addToCampaign({ campaignId: c.id, prospectIds: ids }), {
                    success: (d) => `Added ${d.added}${d.skipped.length ? `, skipped ${d.skipped.length} (excluded or in cooldown)` : ""}`,
                    onSuccess: onDone,
                  })
                }
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button size="xs" variant="outline" asChild>
        <a href={`/api/export/prospects?ids=${ids.join(",")}`}>
          <Download /> Export
        </a>
      </Button>
      <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)} disabled={pending}>
        <Trash2 /> Delete
      </Button>
      <Button size="xs" variant="ghost" className="ml-auto" onClick={onDone} aria-label="Clear selection">
        <XIcon /> Clear
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {ids.length} prospects?</AlertDialogTitle>
            <AlertDialogDescription>Their timelines, messages and research are deleted too. To stop contacting someone, set them to “Do not contact” instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => bulk({ kind: "delete" }, "Deleted")}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortHead({ label, k, className }: { label: string; k: string; className?: string }) {
  const params = useSearchParams();
  const set = useSetParams();
  const active = (params.get("sort") ?? "created") === k;
  return (
    <TableHead className={className}>
      <button type="button" className={cn("hover:text-foreground", active && "text-foreground")} onClick={() => set({ sort: k === "created" ? null : k })}>
        {label}
        {active && " ↓"}
      </button>
    </TableHead>
  );
}

export function ProspectTable({ rows, options, total }: { rows: ProspectRow[]; options: Options; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const { openNewProspect } = useShell();
  // Selection resets whenever the filters (URL params) change.
  const paramKey = params.toString();
  const [sel, setSel] = useState<{ key: string; ids: Set<string> }>({ key: paramKey, ids: new Set() });
  const selected = sel.key === paramKey ? sel.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSel({ key: paramKey, ids });
  const statusMap = useMemo(() => new Map(options.statuses.map((s) => [s.key, s])), [options.statuses]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const filtered = FILTER_KEYS.some((k) => params.get(k));
  const dupes = rows.filter((r) => r.duplicateOf).length;


  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewsMenu options={options} activeName={params.get("viewName")} />
        <SearchBox />
        <ParamSelect param="status" placeholder="All statuses" className="w-40" options={options.statuses.map((s) => ({ value: s.key, label: s.label }))} />
        <ParamSelect param="priority" placeholder="Any priority" className="w-32" options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        <ParamSelect param="channel" placeholder="Any channel" className="w-32" options={[{ value: "email", label: "Email" }, { value: "linkedin", label: "LinkedIn" }, { value: "x", label: "X" }]} />
        {options.tags.length > 0 && <ParamSelect param="tag" placeholder="Any tag" className="w-32" options={options.tags.map((t) => ({ value: t, label: t }))} />}
        {options.campaigns.length > 0 && <ParamSelect param="campaign" placeholder="Any campaign" className="w-40" options={options.campaigns.map((c) => ({ value: c.id, label: c.name }))} />}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/prospects")}>
            Reset
          </Button>
        )}
      </div>

      {selected.size > 0 ? (
        <BulkBar ids={[...selected]} options={options} onDone={() => setSelected(new Set())} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {rows.length} of {total} prospects
          {dupes > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3" /> {dupes} possible duplicate{dupes === 1 ? "" : "s"} (same website domain and name)
            </span>
          )}
        </p>
      )}

      {rows.length === 0 ? (
        total === 0 ? (
          <EmptyState icon={Users} title="No prospects yet" description="Add people you'd genuinely like to work with, import a CSV you're allowed to use, or run a discovery search.">
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={openNewProspect}>
                <UserPlus /> Add prospect
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/prospects/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
            </div>
          </EmptyState>
        ) : (
          <EmptyState icon={Search} title="No prospects match these filters" description="Clear a filter or pick another view." />
        )
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allSelected ? true : selected.size ? "indeterminate" : false}
                    onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Select all"
                  />
                </TableHead>
                <SortHead label="Name" k="name" />
                <TableHead className="hidden md:table-cell">Company</TableHead>
                <TableHead>Status</TableHead>
                <SortHead label="Fit" k="fit" />
                <TableHead className="hidden lg:table-cell">Channel</TableHead>
                <SortHead label="Last contact" k="contacted" className="hidden lg:table-cell" />
                <SortHead label="Follow-up" k="followup" className="hidden sm:table-cell" />
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = statusMap.get(r.status);
                const overdue = r.nextFollowUpAt && r.nextFollowUpAt < new Date();
                return (
                  <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => router.push(`/prospects/${r.id}`)}>
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(c) => {
                          const next = new Set(selected);
                          if (c) next.add(r.id);
                          else next.delete(r.id);
                          setSelected(next);
                        }}
                        aria-label={`Select ${r.fullName}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-56">
                      <Link href={`/prospects/${r.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.fullName}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{r.jobTitle ?? "—"}</span>
                    </TableCell>
                    <TableCell className="hidden max-w-48 md:table-cell">
                      <span className="block truncate">{r.company ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.companyType ?? hostname(r.companyWebsite) ?? ""}
                        {r.duplicateOf && <span className="ml-1 text-warning">· possible duplicate</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <LeadStatusBadge label={st?.label ?? r.status} category={st?.category} />
                      {r.priority === "high" && <span className="ml-1.5 text-xs font-medium text-warning">High</span>}
                    </TableCell>
                    <TableCell><FitScore score={r.fitScore} /></TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{r.preferredChannel ? CHANNEL_LABEL[r.preferredChannel] : "—"}</TableCell>
                    <TableCell className="num hidden text-muted-foreground lg:table-cell">{r.lastContactedAt ? fmtRelative(r.lastContactedAt) : "Never"}</TableCell>
                    <TableCell className={cn("num hidden sm:table-cell", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {r.nextFollowUpAt ? fmtDate(r.nextFollowUpAt, "MMM d") : "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-40 xl:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="font-normal">{t}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {selected.size === 0 && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Select rows to tag, change status, or queue them in a campaign. Click a row to open it.
        </p>
      )}
    </div>
  );
}
