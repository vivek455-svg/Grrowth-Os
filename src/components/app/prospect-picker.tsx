"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { findProspects } from "@/server/actions/shell";
import { cn } from "@/lib/utils";

export type PickedProspect = { id: string; name: string; company: string | null };

export function ProspectPicker({
  value,
  onChange,
  id,
  invalid,
}: {
  value: PickedProspect | null;
  onChange: (p: PickedProspect | null) => void;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedProspect[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await findProspects(q);
      if (!cancelled) {
        setItems(res);
        setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid} className="w-full justify-between font-normal">
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.name}${value.company ? ` · ${value.company}` : ""}` : "Select a prospect"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by name or company…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : "No prospects found."}</CommandEmpty>
            <CommandGroup>
              {items.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === p.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{p.name}</span>
                  {p.company && <span className="truncate text-muted-foreground">{p.company}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
