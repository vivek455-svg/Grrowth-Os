import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetches a public business website for research. Safety:
 *  - http(s) only, standard ports, no credentials in URL
 *  - blocks private, loopback, link-local and metadata IPs (SSRF)
 *  - respects robots.txt Disallow for our user agent and "*"
 *  - timeout, size cap, max 3 redirects (each re-validated)
 * Only the single page requested is fetched; this is not a crawler.
 */
export const USER_AGENT = "GrowthOS-Research/1.0 (+single-page research; respects robots.txt)";
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;

export class FetchBlockedError extends Error {}

function isPrivateIp(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v === "::" || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new FetchBlockedError("That doesn't look like a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new FetchBlockedError("Only http and https URLs can be researched.");
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials aren't allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new FetchBlockedError("Only standard web ports are allowed.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || url.hostname.endsWith(".example"))
    throw new FetchBlockedError("That host can't be fetched.");
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new FetchBlockedError("The domain couldn't be resolved.");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new FetchBlockedError("That address isn't a public website.");
  return url;
}

async function robotsAllows(url: URL): Promise<boolean> {
  try {
    const res = await fetch(new URL("/robots.txt", url.origin), { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(5000), redirect: "follow" });
    if (!res.ok) return true;
    const text = (await res.text()).slice(0, 200_000);
    return robotsAllowsPath(text, url.pathname || "/");
  } catch {
    return true;
  }
}

/** Minimal robots.txt evaluation: longest matching Allow/Disallow for our agent or "*". */
export function robotsAllowsPath(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m as unknown as [string, string, string];
    const k = key.toLowerCase();
    if (k === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((k === "allow" || k === "disallow") && current) {
      if (value) current.rules.push({ allow: k === "allow", path: value });
      lastWasAgent = false;
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && USER_AGENT.toLowerCase().startsWith(a)));
  const applicable = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable)
    for (const r of g.rules) {
      const prefix = r.path.replace(/\*.*$/, "").replace(/\$$/, "");
      if (path.startsWith(prefix) && (!best || prefix.length > best.len || (prefix.length === best.len && r.allow))) best = { allow: r.allow, len: prefix.length };
    }
  return best ? best.allow : true;
}

export type ExtractedPage = {
  url: string;
  finalUrl: string;
  title: string | null;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  ctas: string[];
  trustSignals: string[];
  text: string;
  fetchedAt: string;
};

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " "));

/** Deterministic extraction — every value here is verifiably on the page. */
export function extractPage(html: string, url: string, finalUrl: string): ExtractedPage {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const meta =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1];
  const headings = [...body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ level: Number(m[1]), text: stripTags(m[2]!) }))
    .filter((h) => h.text && h.text.length < 200)
    .slice(0, 30);
  const ctaCandidates = [
    ...[...body.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => stripTags(m[1]!)),
    ...[...body.matchAll(/<a[^>]*class=["'][^"']*(btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[2]!)),
    ...[...body.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => stripTags(m[1]!))
      .filter((t) => /\b(get started|start|try|book|demo|sign up|contact|request|schedule|buy|pricing|free trial|talk to)\b/i.test(t)),
  ];
  const ctas = [...new Set(ctaCandidates.filter((t) => t.length > 1 && t.length < 50))].slice(0, 12);
  const text = stripTags(body).slice(0, 30000);
  const trustPatterns: [RegExp, string][] = [
    [/trusted by|used by|loved by/i, "“Trusted by / used by” statement"],
    [/testimonial|what (our )?customers say|reviews?\b/i, "Testimonials or reviews"],
    [/\bcase stud(y|ies)\b/i, "Case studies"],
    [/\bSOC ?2\b|\bISO ?27001\b|\bGDPR\b|\bHIPAA\b/i, "Security/compliance mention"],
    [/\bG2\b|\bCapterra\b|\bProduct Hunt\b/i, "Third-party review site mention"],
    [/\b\d[\d,]*\+?\s+(customers|teams|companies|users)\b/i, "Customer count claim"],
  ];
  const trustSignals = trustPatterns.filter(([re]) => re.test(text)).map(([, label]) => label);
  return {
    url,
    finalUrl,
    title: title ? decode(title) : null,
    metaDescription: meta ? decode(meta) : null,
    headings,
    ctas,
    trustSignals,
    text,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchPublicPage(raw: string): Promise<ExtractedPage> {
  let url = await assertPublicUrl(raw);
  if (!(await robotsAllows(url))) throw new FetchBlockedError("The site's robots.txt doesn't allow automated access to this page. Research it manually.");
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new FetchBlockedError(`The site responded with HTTP ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) throw new FetchBlockedError("That URL isn't an HTML page.");
    const reader = res.body?.getReader();
    if (!reader) throw new FetchBlockedError("Empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return extractPage(html, raw, url.toString());
  }
  throw new FetchBlockedError("Too many redirects.");
}
