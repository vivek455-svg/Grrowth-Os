/**
 * Outreach safety and lifecycle rules. Pure functions, unit-tested in tests/rules.test.ts.
 */
import type { Channel, EventType, Sentiment } from "@/db/schema";
import { INBOUND_TYPES, OUTBOUND_TYPES } from "@/lib/metrics/outreach";

/** System status progression. Custom statuses are never auto-changed. */
const PROGRESSION = [
  "new",
  "researched",
  "qualified",
  "ready",
  "contacted",
  "replied",
  "interested",
  "call_booked",
  "proposal_sent",
] as const;
const TERMINAL = new Set(["won", "lost", "not_a_fit", "do_not_contact"]);

function rank(status: string) {
  return (PROGRESSION as readonly string[]).indexOf(status);
}

/** Moves a prospect forward (never backward) based on a logged interaction. */
export function nextStatusAfterEvent(current: string, type: EventType, sentiment: Sentiment | null): string {
  if (sentiment === "opt_out") return "do_not_contact";
  if (TERMINAL.has(current)) return current;
  const r = rank(current);
  if (r === -1) return current; // custom status: leave it to the user
  let target: string | null = null;
  if (OUTBOUND_TYPES.includes(type)) target = "contacted";
  if (INBOUND_TYPES.includes(type)) target = sentiment === "positive" ? "interested" : "replied";
  if (type === "call_booked") target = "call_booked";
  if (!target) return current;
  return rank(target) > r ? target : current;
}

export type SuppressionEntry = {
  email: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  xHandle: string | null;
  prospectId: string | null;
};

export type ContactTarget = {
  id: string;
  status: string;
  email: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  companyWebsite: string | null;
  websiteUrl: string | null;
};

export function normalizeDomain(url: string | null | undefined) {
  if (!url) return null;
  const m = url.toLowerCase().trim().match(/^(?:https?:\/\/)?(?:www\.)?([^/?#\s]+)/);
  return m?.[1] ?? null;
}

export function normalizeLinkedin(url: string | null | undefined) {
  if (!url) return null;
  const m = url.toLowerCase().trim().match(/linkedin\.com\/in\/([^/?#\s]+)/);
  return m?.[1] ?? url.toLowerCase().trim();
}

export function normalizeXHandle(v: string | null | undefined) {
  if (!v) return null;
  const m = v.toLowerCase().trim().match(/(?:(?:x|twitter)\.com\/)?@?([a-z0-9_]{1,15})\/?$/);
  return m?.[1] ?? null;
}

/** Returns the reason a prospect must not be contacted, or null if contact is allowed. */
export function suppressionReason(p: ContactTarget, list: SuppressionEntry[]): string | null {
  if (p.status === "do_not_contact") return "Marked as do not contact";
  if (p.status === "not_a_fit") return "Marked as not a fit";
  const email = p.email?.toLowerCase() ?? null;
  const emailDomain = email?.split("@")[1] ?? null;
  const linkedin = normalizeLinkedin(p.linkedinUrl);
  const x = normalizeXHandle(p.xUrl);
  for (const s of list) {
    if (s.prospectId && s.prospectId === p.id) return "On the suppression list";
    if (s.email && email && s.email.toLowerCase() === email) return "Email is on the suppression list";
    if (s.domain && (s.domain === emailDomain || s.domain === normalizeDomain(p.companyWebsite ?? p.websiteUrl)))
      return "Domain is on the suppression list";
    if (s.linkedinUrl && linkedin && normalizeLinkedin(s.linkedinUrl) === linkedin) return "LinkedIn profile is suppressed";
    if (s.xHandle && x && normalizeXHandle(s.xHandle) === x) return "X handle is suppressed";
  }
  return null;
}

/** Duplicate-outreach protection: blocks a new initial message inside the cooldown window. */
export function cooldownBlock(lastContactedAt: Date | null, cooldownDays: number, now = new Date()): string | null {
  if (!lastContactedAt || cooldownDays <= 0) return null;
  const until = new Date(lastContactedAt.getTime() + cooldownDays * 86400000);
  if (until <= now) return null;
  return `Contacted ${Math.floor((now.getTime() - lastContactedAt.getTime()) / 86400000)} days ago (cooldown is ${cooldownDays} days).`;
}

/**
 * A follow-up must not go out if the prospect replied after our last outbound message,
 * opted out, or is suppressed.
 */
export function followUpBlock(input: {
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  suppression: string | null;
}): string | null {
  if (input.suppression) return input.suppression;
  if (input.lastInboundAt && (!input.lastOutboundAt || input.lastInboundAt > input.lastOutboundAt))
    return "The prospect replied after your last message — respond to the conversation instead of a follow-up.";
  return null;
}

export type DuplicateCandidate = {
  id: string;
  fullName: string;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  companyWebsite: string | null;
  websiteUrl: string | null;
};

export type DuplicateMatch = { id: string; fullName: string; reason: "email" | "linkedin" | "name_domain" };

/** Finds likely duplicates by email, LinkedIn profile, or same name at the same domain. */
export function findDuplicates(
  input: { fullName: string; email?: string | null; linkedinUrl?: string | null; companyWebsite?: string | null; websiteUrl?: string | null },
  existing: DuplicateCandidate[],
): DuplicateMatch[] {
  const email = input.email?.toLowerCase().trim() || null;
  const linkedin = normalizeLinkedin(input.linkedinUrl);
  const domain = normalizeDomain(input.companyWebsite ?? input.websiteUrl);
  const name = input.fullName.toLowerCase().replace(/\s+/g, " ").trim();
  const out: DuplicateMatch[] = [];
  for (const p of existing) {
    if (email && p.email?.toLowerCase() === email) out.push({ id: p.id, fullName: p.fullName, reason: "email" });
    else if (linkedin && normalizeLinkedin(p.linkedinUrl) === linkedin)
      out.push({ id: p.id, fullName: p.fullName, reason: "linkedin" });
    else if (
      domain &&
      normalizeDomain(p.companyWebsite ?? p.websiteUrl) === domain &&
      p.fullName.toLowerCase().replace(/\s+/g, " ").trim() === name
    )
      out.push({ id: p.id, fullName: p.fullName, reason: "name_domain" });
  }
  return out;
}

export const CHANNEL_PROFILE_URL = (p: { email: string | null; linkedinUrl: string | null; xUrl: string | null }, c: Channel) =>
  c === "email" ? (p.email ? `mailto:${p.email}` : null) : c === "linkedin" ? p.linkedinUrl : p.xUrl;
