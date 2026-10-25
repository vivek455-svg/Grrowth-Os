"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
}

/** Date range: presets first, custom range behind a popover. Scopes everything below it. */
export function RangeFilter() {
  const params = useSearchParams();
  const set = useSetParams();
  const range = params.get("range") ?? "30d";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={range === "custom" ? "" : range}
        onValueChange={(v) => v && set({ range: v === "30d" ? null : v, from: null, to: null })}
        aria-label="Date range"
      >
        <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
        <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
        <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
      </ToggleGroup>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={range === "custom" ? "secondary" : "outline"} size="sm">
            <CalendarRange />
            {range === "custom" && params.get("from") ? `${params.get("from")} → ${params.get("to")}` : "Custom"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rf-from">From</Label>
            <Input id="rf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rf-to">To</Label>
            <Input id="rf-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!from || !to || to < from}
            onClick={() => {
              set({ range: "custom", from, to });
              setOpen(false);
            }}
          >
            Apply range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ParamSelect({
  param,
  options,
  placeholder,
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  placeholder: string;
  className?: string;
}) {
  const params = useSearchParams();
  const set = useSetParams();
  return (
    <Select value={params.get(param) ?? "all"} onValueChange={(v) => set({ [param]: v })}>
      <SelectTrigger size="sm" className={className ?? "w-40"} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
