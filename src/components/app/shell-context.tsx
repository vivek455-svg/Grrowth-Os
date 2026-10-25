"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PickedProspect } from "./prospect-picker";
import { NewPostDialog } from "@/components/content/new-post-dialog";
import { ProspectFormDialog } from "@/components/prospects/prospect-form";
import { LogInteractionDialog } from "@/components/prospects/log-interaction-dialog";

export type ShellOptions = {
  pillars: { id: string; name: string }[];
  statuses: { key: string; label: string; category: string }[];
  campaigns: { id: string; name: string }[];
  isDemo: boolean;
};

type Open =
  | { kind: "post"; plannedAt?: Date; title?: string; body?: string; ideaId?: string; pillarId?: string | null }
  | { kind: "prospect" }
  | { kind: "interaction"; prospect?: PickedProspect }
  | null;

type Ctx = ShellOptions & {
  openNewPost: (o?: Omit<Extract<Open, { kind: "post" }>, "kind">) => void;
  openNewProspect: () => void;
  openLogInteraction: (prospect?: PickedProspect) => void;
};

const ShellContext = createContext<Ctx | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside ShellProvider");
  return ctx;
}

export function ShellProvider({ options, children }: { options: ShellOptions; children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  const value = useMemo<Ctx>(
    () => ({
      ...options,
      openNewPost: (o) => setOpen({ kind: "post", ...o }),
      openNewProspect: () => setOpen({ kind: "prospect" }),
      openLogInteraction: (prospect) => setOpen({ kind: "interaction", prospect }),
    }),
    [options],
  );
  return (
    <ShellContext value={value}>
      {children}
      {open?.kind === "post" && <NewPostDialog open onOpenChange={(o) => !o && close()} defaults={open} pillars={options.pillars} />}
      {open?.kind === "prospect" && <ProspectFormDialog open onOpenChange={(o) => !o && close()} statuses={options.statuses} />}
      {open?.kind === "interaction" && (
        <LogInteractionDialog open onOpenChange={(o) => !o && close()} prospect={open.prospect} campaigns={options.campaigns} />
      )}
    </ShellContext>
  );
}
