/**
 * CSV import definitions and pure validation (unit-tested). Server actions use these to
 * preview and commit imports; nothing is written until the user confirms the preview.
 */
import { z } from "zod";
import { findDuplicates, type DuplicateCandidate } from "./outreach-rules";

export type ImportField = { key: string; label: string; required?: boolean; aliases: string[] };

export const PROSPECT_FIELDS: ImportField[] = [
  { key: "fullName", label: "Full name", required: true, aliases: ["name", "full name", "fullname", "contact", "contact name"] },
  { key: "firstName", label: "First name (combined with last)", aliases: ["first name", "firstname", "first"] },
  { key: "lastName", label: "Last name", aliases: ["last name", "lastname", "surname", "last"] },
  { key: "jobTitle", label: "Job title", aliases: ["title", "job title", "position", "role"] },
  { key: "company", label: "Company", aliases: ["company", "company name", "organization", "organisation"] },
  { key: "companyWebsite", label: "Company website", aliases: ["website", "company website", "url", "domain", "site"] },
  { key: "email", label: "Work email", aliases: ["email", "work email", "e-mail", "email address"] },
  { key: "linkedinUrl", label: "LinkedIn URL", aliases: ["linkedin", "linkedin url", "linkedin profile"] },
  { key: "xUrl", label: "X URL", aliases: ["x", "twitter", "x url", "twitter url"] },
  { key: "location", label: "Location", aliases: ["location", "city", "country"] },
  { key: "companyType", label: "Company type", aliases: ["company type", "type", "segment"] },
  { key: "industry", label: "Industry", aliases: ["industry", "vertical"] },
  { key: "companySize", label: "Company size", aliases: ["size", "company size", "employees", "headcount"] },
  { key: "source", label: "Source", aliases: ["source", "lead source"] },
  { key: "tags", label: "Tags (comma separated)", aliases: ["tags", "labels"] },
  { key: "personalizationNotes", label: "Notes", aliases: ["notes", "note", "comments"] },
  { key: "fitScore", label: "Fit score (0–100)", aliases: ["fit", "fit score", "score"] },
];

export const CONTENT_FIELDS: ImportField[] = [
  { key: "platform", label: "Platform (x / linkedin)", required: true, aliases: ["platform", "network", "channel"] },
  { key: "text", label: "Post text", required: true, aliases: ["text", "post", "content", "body", "commentary", "tweet text"] },
  { key: "publishedAt", label: "Published at", required: true, aliases: ["date", "published", "published at", "time", "created at", "post date"] },
  { key: "url", label: "Post URL", aliases: ["url", "link", "permalink", "post link"] },
  { key: "title", label: "Internal label", aliases: ["title", "label", "name"] },
  { key: "impressions", label: "Impressions", aliases: ["impressions", "views"] },
  { key: "likes", label: "Likes / reactions", aliases: ["likes", "reactions"] },
  { key: "replies", label: "Replies / comments", aliases: ["replies", "comments"] },
  { key: "reposts", label: "Reposts / shares", aliases: ["reposts", "retweets", "shares", "reposts/shares"] },
  { key: "bookmarks", label: "Bookmarks", aliases: ["bookmarks", "saves"] },
  { key: "linkClicks", label: "Link clicks", aliases: ["link clicks", "url clicks", "clicks"] },
  { key: "profileVisits", label: "Profile visits", aliases: ["profile visits", "profile clicks", "user profile clicks"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Guesses a header → field mapping from common column names. */
export function guessMapping(headers: string[], fields: ImportField[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const h = headers.find((x) => !used.has(x) && (f.aliases.includes(norm(x)) || norm(x) === norm(f.label)));
    if (h) {
      out[f.key] = h;
      used.add(h);
    }
  }
  return out;
}

export function applyMapping(rows: Record<string, string>[], mapping: Record<string, string>) {
  return rows.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([k, h]) => [k, (r[h] ?? "").trim()])));
}

const url = z
  .string()
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "invalid URL");

export type ProspectRowResult = {
  index: number;
  data: {
    fullName: string;
    jobTitle: string | null;
    company: string | null;
    companyWebsite: string | null;
    email: string | null;
    linkedinUrl: string | null;
    xUrl: string | null;
    location: string | null;
    companyType: string | null;
    industry: string | null;
    companySize: string | null;
    source: string | null;
    tags: string[];
    personalizationNotes: string | null;
    fitScore: number | null;
  } | null;
  errors: string[];
  duplicateOf: { id: string; fullName: string; reason: string } | null;
  duplicateInFile: number | null;
};

export function validateProspectRows(rows: Record<string, string>[], existing: DuplicateCandidate[]): ProspectRowResult[] {
  const seen = new Map<string, number>();
  return rows.map((r, index) => {
    const errors: string[] = [];
    const fullName = (r.fullName || [r.firstName, r.lastName].filter(Boolean).join(" ")).trim();
    if (!fullName) errors.push("Missing name");
    if (fullName.length > 200) errors.push("Name too long");
    const email = (r.email ?? "").toLowerCase();
    if (email && !z.email().safeParse(email).success) errors.push("Invalid email");
    const parsedUrls: Record<string, string | null> = {};
    for (const k of ["companyWebsite", "linkedinUrl", "xUrl"] as const) {
      const res = url.safeParse(r[k] ?? "");
      if (!res.success) errors.push(`Invalid ${k === "companyWebsite" ? "website" : k === "linkedinUrl" ? "LinkedIn URL" : "X URL"}`);
      parsedUrls[k] = res.success && res.data ? res.data : null;
    }
    const fit = r.fitScore ? Number(r.fitScore) : null;
    if (r.fitScore && (!Number.isInteger(fit) || fit! < 0 || fit! > 100)) errors.push("Fit score must be 0–100");
    if (errors.length) return { index, data: null, errors, duplicateOf: null, duplicateInFile: null };

    const data = {
      fullName,
      jobTitle: r.jobTitle || null,
      company: r.company || null,
      companyWebsite: parsedUrls.companyWebsite!,
      email: email || null,
      linkedinUrl: parsedUrls.linkedinUrl!,
      xUrl: parsedUrls.xUrl!,
      location: r.location || null,
      companyType: r.companyType || null,
      industry: r.industry || null,
      companySize: r.companySize || null,
      source: r.source || "CSV import",
      tags: (r.tags ?? "").split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      personalizationNotes: r.personalizationNotes || null,
      fitScore: fit,
    };
    const dup = findDuplicates(data, existing)[0] ?? null;
    const keys = [email && `e:${email}`, data.linkedinUrl && `l:${data.linkedinUrl.toLowerCase().replace(/\/$/, "")}`].filter(Boolean) as string[];
    let duplicateInFile: number | null = null;
    for (const k of keys) {
      if (seen.has(k)) duplicateInFile = seen.get(k)!;
      else seen.set(k, index);
    }
    return { index, data, errors, duplicateOf: dup ? { id: dup.id, fullName: dup.fullName, reason: dup.reason } : null, duplicateInFile };
  });
}

const int = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

type ImportedMetrics = { impressions: number | null; likes: number | null; replies: number | null; reposts: number | null; bookmarks: number | null; linkClicks: number | null; profileVisits: number | null };

export type ContentRowResult = {
  index: number;
  data: { platform: "x" | "linkedin"; text: string; publishedAt: Date; url: string | null; title: string; metrics: ImportedMetrics } | null;
  errors: string[];
};

export function validateContentRows(rows: Record<string, string>[]): ContentRowResult[] {
  return rows.map((r, index) => {
    const errors: string[] = [];
    const p = norm(r.platform ?? "");
    const platform = p === "x" || p === "twitter" ? "x" : p === "linkedin" ? "linkedin" : null;
    if (!platform) errors.push("Platform must be X or LinkedIn");
    const text = (r.text ?? "").trim();
    if (!text) errors.push("Missing post text");
    const publishedAt = new Date(r.publishedAt ?? "");
    if (Number.isNaN(publishedAt.getTime())) errors.push("Invalid publish date");
    else if (publishedAt > new Date()) errors.push("Publish date is in the future");
    const metrics = {
      impressions: int(r.impressions),
      likes: int(r.likes),
      replies: int(r.replies),
      reposts: int(r.reposts),
      bookmarks: int(r.bookmarks),
      linkClicks: int(r.linkClicks),
      profileVisits: int(r.profileVisits),
    };
    for (const [k, v] of Object.entries(metrics)) if (Number.isNaN(v)) errors.push(`${k} must be a whole number`);
    const u = url.safeParse(r.url ?? "");
    if (!u.success) errors.push("Invalid post URL");
    if (errors.length) return { index, data: null, errors };
    return {
      index,
      errors,
      data: {
        platform: platform!,
        text,
        publishedAt,
        url: u.success && u.data ? u.data : null,
        title: (r.title || text.split("\n")[0]!).slice(0, 120),
        metrics: metrics as ImportedMetrics, // NaN values were rejected above
      },
    };
  });
}

/** Neutralises spreadsheet formula injection when exporting user-controlled text. */
export function csvSafe(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(", ") : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
