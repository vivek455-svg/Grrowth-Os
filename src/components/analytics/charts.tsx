"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { fmtNumber, fmtPercent } from "@/lib/format";

const platformConfig = {
  linkedin: { label: "LinkedIn", color: "var(--chart-1)" },
  x: { label: "X", color: "var(--chart-2)" },
} satisfies ChartConfig;

const tick = { fontSize: 11, fill: "var(--chart-axis)" };

function shortDate(v: string) {
  const d = new Date(`${v}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Impressions by platform over time. Grouped (not stacked) bars: platform impression
 * definitions differ, so summing them would imply a comparable total.
 */
export function PlatformTrendChart({ data, xKey }: { data: { [k: string]: string | number | null }[]; xKey: string }) {
  return (
    <ChartContainer config={platformConfig} className="aspect-auto h-56 w-full">
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={tick} tickFormatter={shortDate} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={tick} width={44} tickFormatter={(v) => fmtNumber(v, { compact: true })} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar isAnimationActive={false} dataKey="linkedin" fill="var(--color-linkedin)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar isAnimationActive={false} dataKey="x" fill="var(--color-x)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/** Horizontal bars of median engagement rate per group, with sample size in the label. */
export function GroupRateChart({ data }: { data: { label: string; rate: number | null; posts: number; sufficient: boolean }[] }) {
  const rows = data.filter((d) => d.rate !== null).map((d) => ({ ...d, name: `${d.label} (n=${d.posts})` }));
  const config = { rate: { label: "Median engagement rate", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(120, rows.length * 34 + 24) }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={tick} tickFormatter={(v) => fmtPercent(v, 0)} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ ...tick, fill: "var(--muted-foreground)" }} width={190} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent formatter={(v) => <span className="num font-medium">{fmtPercent(Number(v))}</span>} />}
        />
        <Bar isAnimationActive={false} dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {rows.map((r) => (
            <Cell key={r.name} fill="var(--color-rate)" fillOpacity={r.sufficient ? 1 : 0.35} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function FollowerChart({ data }: { data: { date: string; linkedin: number | null; x: number | null }[] }) {
  return (
    <ChartContainer config={platformConfig} className="aspect-auto h-48 w-full">
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={tick} tickFormatter={shortDate} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tick={tick} width={44} tickFormatter={(v) => fmtNumber(v, { compact: true })} domain={["auto", "auto"]} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line isAnimationActive={false} dataKey="linkedin" stroke="var(--color-linkedin)" strokeWidth={2} dot={false} connectNulls />
        <Line isAnimationActive={false} dataKey="x" stroke="var(--color-x)" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ChartContainer>
  );
}

/** Funnel of outreach stages as ordered horizontal bars (single hue). */
export function FunnelChart({ data }: { data: { stage: string; value: number }[] }) {
  const config = { value: { label: "Prospects", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: data.length * 34 + 16 }}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="stage" tickLine={false} axisLine={false} tick={{ ...tick, fill: "var(--muted-foreground)" }} width={130} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent />} />
        <Bar isAnimationActive={false} dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fontSize: 11, fill: "var(--foreground)" }} />
      </BarChart>
    </ChartContainer>
  );
}
