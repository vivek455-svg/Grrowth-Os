"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Copy, ExternalLink, LayoutGrid, Lightbulb, List, MoreHorizontal, Pencil, Repeat2, Search, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ContentStatusBadge, MetricSourceBadge, PlatformBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { ParamSelect, useSetParams } from "@/components/analytics/range-filter";
import { useShell } from "@/components/app/shell-context";
import { archiveContent, duplicateContent, setIdeaStatus } from "@/server/actions/content";
import { useAction } from "@/hooks/use-action";
import { fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { CONTENT_STATUS_LABEL, FORMAT_LABEL } from "@/lib/labels";
import type { ContentFormat, ContentStatus, MetricSource, Platform } from "@/db/schema";
import { cn } from "@/lib/utils";

export type LibraryPost = {
  versionId: string;
  itemId: string;
  title: string;
  platform: Platform;
  format: string;
  status: ContentStatus;
  pillarName: string | null;
  date: string | null;
  excerpt: string;
  impressions: number | null;
  engagementRate: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
  source: string | null;
  url: string | null;
  tier: "top" | "under" | null;
  archived: boolean;
  otherPlatforms: Platform[];
  tags: string[];
};

function SortHead({ label, k, className }: { label: string; k: string; className?: string }) {
  const params = useSearchParams();
  const set = useSetParams();
  const active = (params.get("sort") ?? "date") === k;
  return (
    <TableHead className={className}>
      <button type="button" className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")} onClick={() => set({ sort: k === "date" ? null : k })}>
        {label}
        {active && <span aria-hidden>↓</span>}
      </button>
    </TableHead>
  );
}

function RowMenu({ p }: { p: LibraryPost }) {
  const router = useRouter();
  const { run } = useAction();
  const target: Platform = p.platform === "x" ? "linkedin" : "x";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.title}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(`/content/${p.itemId}?v=${p.versionId}`)}>
          <Pencil /> Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => duplicateContent({ id: p.itemId }), { success: "Duplicated as a draft" })}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        {!p.otherPlatforms.includes(target) && (
          <DropdownMenuItem onSelect={() => router.push(`/content/${p.itemId}?repurpose=${target}&from=${p.versionId}`)}>
            <Repeat2 /> Repurpose for {target === "x" ? "X" : "LinkedIn"}
          </DropdownMenuItem>
        )}
        {p.url && (
          <DropdownMenuItem asChild>
            <a href={p.url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open published post
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run(() => archiveContent({ id: p.itemId, archived: !p.archived }), { success: p.archived ? "Restored" : "Archived" })}>
          {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? "Restore" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TierBadge({ tier }: { tier: LibraryPost["tier"] }) {
  if (!tier) return null;
  return (
    <Badge variant="outline" className={cn("font-normal", tier === "top" ? "text-success" : "text-muted-foreground")}>
      {tier === "top" ? "Top 25%" : "Bottom 25%"}
    </Badge>
  );
}

export function LibrarySearch() {
  const params = useSearchParams();
  const set = useSetParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q: q || null });
    }, 250);
    return () => clearTimeout(t);
  }, [q, params, set]);
  return (
    <InputGroup className="w-full sm:w-72">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search text, topic, keyword or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search content" />
      {q && (
        <InputGroupAddon align="inline-end">
          <button type="button" onClick={() => setQ("")} aria-label="Clear search">
            <XIcon className="size-3.5" />
          </button>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

export function LibraryView({ posts, pillars, view, rateNote }: { posts: LibraryPost[]; pillars: { id: string; name: string }[]; view: "table" | "cards"; rateNote: string }) {
  const set = useSetParams();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <LibrarySearch />
        <ParamSelect param="platform" placeholder="All platforms" className="w-36" options={[{ value: "linkedin", label: "LinkedIn" }, { value: "x", label: "X" }]} />
        <ParamSelect param="pillar" placeholder="All pillars" className="w-44" options={pillars.map((p) => ({ value: p.id, label: p.name }))} />
        <ParamSelect param="status" placeholder="All statuses" className="w-36" options={Object.entries(CONTENT_STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
        <ParamSelect param="perf" placeholder="Any performance" className="w-40" options={[{ value: "top", label: "Top 25%" }, { value: "under", label: "Bottom 25%" }, { value: "no_metrics", label: "Missing metrics" }]} />
        <ParamSelect param="period" placeholder="Any date" className="w-36" options={[{ value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 12 months" }]} />
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set({ view: v === "table" ? null : v })} className="ml-auto" aria-label="Layout">
          <ToggleGroupItem value="table" aria-label="Table view"><List /></ToggleGroupItem>
          <ToggleGroupItem value="cards" aria-label="Card view"><LayoutGrid /></ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="text-xs text-muted-foreground">{posts.length} posts · {rateNote}</p>

      {posts.length === 0 ? (
        <EmptyState icon={Search} title="No posts match" description="Try clearing a filter or searching for a different keyword." />
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => (
            <Card key={p.versionId} size="sm" className="gap-2">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PlatformBadge platform={p.platform} />
                    <ContentStatusBadge status={p.status} />
                    <TierBadge tier={p.tier} />
                  </div>
                  <Link href={`/content/${p.itemId}?v=${p.versionId}`} className="line-clamp-2 text-sm font-medium hover:underline">
                    {p.title}
                  </Link>
                </div>
                <RowMenu p={p} />
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">{p.excerpt || "No copy yet."}</p>
              </CardContent>
              <CardFooter className="mt-auto justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>{p.date ? fmtDate(p.date) : "Unscheduled"}</span>
                <span className="num">
                  {fmtNumber(p.impressions, { compact: true })} impr · {fmtPercent(p.engagementRate)} ER
                </span>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Post</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="hidden md:table-cell">Pillar</TableHead>
                <TableHead>Status</TableHead>
                <SortHead label="Date" k="date" />
                <SortHead label="Impressions" k="impressions" className="text-right" />
                <SortHead label="Eng. rate" k="rate" className="text-right" />
                <SortHead label="Clicks" k="clicks" className="hidden text-right lg:table-cell" />
                <SortHead label="Visits" k="visits" className="hidden text-right lg:table-cell" />
                <TableHead className="hidden xl:table-cell">Source</TableHead>
                <TableHead className="w-10 pr-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((p) => (
                <TableRow key={p.versionId} className={cn(p.archived && "opacity-60")}>
                  <TableCell className="max-w-80 pl-4">
                    <Link href={`/content/${p.itemId}?v=${p.versionId}`} className="block truncate font-medium hover:underline">
                      {p.title}
                    </Link>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {FORMAT_LABEL[p.format as ContentFormat]}
                      <TierBadge tier={p.tier} />
                      {p.tags.slice(0, 2).map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell><PlatformBadge platform={p.platform} /></TableCell>
                  <TableCell className="hidden max-w-40 truncate text-muted-foreground md:table-cell">{p.pillarName ?? "—"}</TableCell>
                  <TableCell><ContentStatusBadge status={p.status} /></TableCell>
                  <TableCell className="num text-muted-foreground">{p.date ? fmtDate(p.date, "MMM d") : "—"}</TableCell>
                  <TableCell className="num text-right">{fmtNumber(p.impressions)}</TableCell>
                  <TableCell className="num text-right">{fmtPercent(p.engagementRate)}</TableCell>
                  <TableCell className="num hidden text-right lg:table-cell">{fmtNumber(p.linkClicks)}</TableCell>
                  <TableCell className="num hidden text-right lg:table-cell">{fmtNumber(p.profileVisits)}</TableCell>
                  <TableCell className="hidden xl:table-cell">{p.status === "published" ? <MetricSourceBadge source={p.source as MetricSource | null} /> : null}</TableCell>
                  <TableCell className="pr-2"><RowMenu p={p} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function IdeasList({ ideas }: { ideas: { id: string; title: string; notes: string | null; source: string; pillarId: string | null; pillarName: string | null; createdAt: Date }[] }) {
  const { openNewPost } = useShell();
  const { run, pending } = useAction();
  if (!ideas.length)
    return (
      <EmptyState icon={Lightbulb} title="No saved ideas" description="Save ideas from the AI Content Lab, from insights, or add them here with “Save idea”." />
    );
  return (
    <Card className="gap-0 p-0">
      <ul className="divide-y">
        {ideas.map((i) => (
          <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{i.title}</p>
              {i.notes && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.notes}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {i.pillarName ?? "No pillar"} · {i.source} · {fmtDate(i.createdAt)}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="xs" variant="outline" onClick={() => openNewPost({ title: i.title.replace(/^Idea from insight: /, ""), body: "", ideaId: i.id, pillarId: i.pillarId })}>
                Create post
              </Button>
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setIdeaStatus({ id: i.id, status: "dismissed" }))}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
