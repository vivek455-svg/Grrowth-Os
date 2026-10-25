"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Briefcase,
  CalendarPlus,
  FileText,
  LogOut,
  Megaphone,
  MessageSquarePlus,
  NotebookPen,
  Plug,
  Plus,
  Search,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { globalSearch, signOut } from "@/server/actions/shell";
import type { Notification } from "@/server/queries/shell";
import { useShell } from "./shell-context";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Results = Awaited<ReturnType<typeof globalSearch>>;

function GlobalSearch() {
  const router = useRouter();
  const { openNewPost, openNewProspect, openLogInteraction } = useShell();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => startTransition(async () => setResults(await globalSearch(q))), 150);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim() ? results : null;

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const act = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-xs justify-start gap-2 bg-background px-2.5 font-normal text-muted-foreground sm:w-64"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search prospects, content, campaigns and opportunities">
        <CommandInput placeholder="Search prospects, posts, campaigns…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {shown && (
            <>
              {shown.prospects.length > 0 && (
                <CommandGroup heading="Prospects">
                  {shown.prospects.map((p) => (
                    <CommandItem key={p.id} value={`p-${p.id}`} onSelect={() => go(`/prospects/${p.id}`)}>
                      <Users />
                      {p.name}
                      {p.company && <span className="text-muted-foreground">{p.company}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {shown.content.length > 0 && (
                <CommandGroup heading="Content">
                  {shown.content.map((c) => (
                    <CommandItem key={c.id} value={`c-${c.id}`} onSelect={() => go(`/content/${c.id}`)}>
                      <FileText />
                      {c.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {shown.campaigns.length > 0 && (
                <CommandGroup heading="Campaigns">
                  {shown.campaigns.map((c) => (
                    <CommandItem key={c.id} value={`cp-${c.id}`} onSelect={() => go(`/campaigns/${c.id}`)}>
                      <Megaphone />
                      {c.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {shown.opportunities.length > 0 && (
                <CommandGroup heading="Opportunities">
                  {shown.opportunities.map((o) => (
                    <CommandItem key={o.id} value={`o-${o.id}`} onSelect={() => go(`/opportunities?open=${o.id}`)}>
                      <Briefcase />
                      {o.name}
                      {o.company && <span className="text-muted-foreground">{o.company}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading="Quick actions">
            <CommandItem value="new post" onSelect={() => act(() => openNewPost())}>
              <CalendarPlus /> New post
            </CommandItem>
            <CommandItem value="add prospect" onSelect={() => act(openNewProspect)}>
              <UserPlus /> Add prospect
            </CommandItem>
            <CommandItem value="draft outreach" onSelect={() => go("/outreach/compose")}>
              <MessageSquarePlus /> Draft outreach
            </CommandItem>
            <CommandItem value="log interaction" onSelect={() => act(() => openLogInteraction())}>
              <NotebookPen /> Log interaction
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

function QuickCreate() {
  const router = useRouter();
  const { openNewPost, openNewProspect, openLogInteraction } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus /> <span className="hidden sm:inline">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => openNewPost()}>
          <CalendarPlus /> New post
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openNewProspect}>
          <UserPlus /> Add prospect
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/outreach/compose")}>
          <MessageSquarePlus /> Draft outreach
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openLogInteraction()}>
          <NotebookPen /> Log interaction
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Notifications({ items }: { items: Notification[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${items.length})`}>
          <Bell />
          {items.length > 0 && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.href} className="flex gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/60">
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      n.tone === "danger" ? "bg-destructive" : n.tone === "warning" ? "bg-warning" : "bg-info",
                    )}
                    aria-hidden
                  />
                  <span>
                    <span className="block font-medium">{n.title}</span>
                    <span className="block text-xs text-muted-foreground">{n.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu({ name, email, isDemo }: { name: string | null; email: string | null; isDemo: boolean }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(name ?? email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{name ?? "Your account"}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
          {isDemo && <Badge variant="outline" className="mt-1.5">Demo workspace</Badge>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings /> Settings <DropdownMenuShortcut />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/integrations")}>
          <Plug /> Integrations
        </DropdownMenuItem>
        {!isDemo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader({
  notifications,
  name,
  email,
  isDemo,
}: {
  notifications: Notification[];
  name: string | null;
  email: string | null;
  isDemo: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1">
        <QuickCreate />
        <Notifications items={notifications} />
        <AccountMenu name={name} email={email} isDemo={isDemo} />
      </div>
    </header>
  );
}
