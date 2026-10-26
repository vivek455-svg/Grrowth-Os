import { cn } from "@/lib/utils";

/** Forest-green mark with a single vermilion dot: the one place the accent is always present. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}>
      <span className="text-xs font-semibold tracking-tight">GO</span>
      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-background" aria-hidden />
    </div>
  );
}
