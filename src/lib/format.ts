import { format, formatDistanceToNowStrict, isValid } from "date-fns";

const nf = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function fmtNumber(v: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return opts.compact && Math.abs(v) >= 10000 ? compact.format(v) : nf.format(v);
}

export function fmtPercent(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtMoney(cents: number | null | undefined, currency = "USD") {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isValid(d) ? d : null;
}

export function fmtDate(v: Date | string | null | undefined, pattern = "MMM d, yyyy") {
  const d = toDate(v);
  return d ? format(d, pattern) : "—";
}

export function fmtDateTime(v: Date | string | null | undefined) {
  return fmtDate(v, "MMM d, yyyy · h:mm a");
}

export function fmtRelative(v: Date | string | null | undefined) {
  const d = toDate(v);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : "—";
}

/** Value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInput(v: Date | string | null | undefined) {
  const d = toDate(v);
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : "";
}

export function toDateInput(v: Date | string | null | undefined) {
  const d = toDate(v);
  return d ? format(d, "yyyy-MM-dd") : "";
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function hostname(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function truncate(s: string | null | undefined, n: number) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
