import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { fetchJson, getAccessToken, IntegrationError } from "./oauth";
import { LINKEDIN_API_VERSION } from "./registry";
import type { Platform } from "@/db/schema";

/**
 * Provider interfaces. The app depends on these, never on a specific API, so providers can
 * be swapped and missing ones fall back to manual workflows.
 */
export interface SocialPublishingProvider {
  platform: Platform;
  publish(userId: string, text: string): Promise<{ postId: string; url: string | null }>;
}

export type PostMetrics = {
  postId: string;
  createdAt: Date;
  text: string;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  bookmarks: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
};

export interface SocialAnalyticsProvider {
  platform: Platform;
  recentPosts(userId: string, max: number): Promise<{ posts: PostMetrics[]; followers: number | null; handle: string | null }>;
}

export interface EmailProvider {
  send(userId: string, msg: { to: string; subject: string; body: string; fromName?: string | null }): Promise<{ messageId: string; threadId: string | null }>;
}

export interface MessagingProvider {
  /** Direct messaging is intentionally not implemented for LinkedIn or X (see registry). */
  canSend: false;
}

export type SearchResult = { title: string; url: string; description: string };
export interface ProspectResearchProvider {
  search(query: string, count: number): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// X
// ---------------------------------------------------------------------------
export const xProvider: SocialPublishingProvider & SocialAnalyticsProvider = {
  platform: "x",
  async publish(userId, text) {
    if (text.length > 280) throw new IntegrationError("X posts are limited to 280 characters. Shorten it or publish manually as a thread.");
    const { token } = await getAccessToken(userId, "x");
    const r = await fetchJson<{ data: { id: string } }>("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return { postId: r.data.id, url: `https://x.com/i/web/status/${r.data.id}` };
  },
  async recentPosts(userId, max) {
    const { token, accountId } = await getAccessToken(userId, "x");
    const me = await fetchJson<{ data: { id: string; username: string; public_metrics?: { followers_count: number } } }>(
      "https://api.x.com/2/users/me?user.fields=public_metrics",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const id = accountId ?? me.data.id;
    // non_public_metrics are only returned for the user's own posts from the last 30 days.
    const since = new Date(Date.now() - 29 * 86400000).toISOString();
    type Tweet = {
      id: string;
      text: string;
      created_at: string;
      public_metrics?: { impression_count?: number; like_count: number; reply_count: number; retweet_count: number; quote_count: number; bookmark_count?: number };
      non_public_metrics?: { url_link_clicks?: number; user_profile_clicks?: number; impression_count?: number };
    };
    const r = await fetchJson<{ data?: Tweet[] }>(
      `https://api.x.com/2/users/${id}/tweets?max_results=${Math.min(Math.max(max, 5), 100)}&start_time=${since}&exclude=retweets,replies&tweet.fields=created_at,public_metrics,non_public_metrics`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return {
      followers: me.data.public_metrics?.followers_count ?? null,
      handle: me.data.username,
      posts: (r.data ?? []).map((t) => ({
        postId: t.id,
        createdAt: new Date(t.created_at),
        text: t.text,
        impressions: t.non_public_metrics?.impression_count ?? t.public_metrics?.impression_count ?? null,
        likes: t.public_metrics?.like_count ?? null,
        replies: t.public_metrics?.reply_count ?? null,
        reposts: t.public_metrics ? t.public_metrics.retweet_count + t.public_metrics.quote_count : null,
        bookmarks: t.public_metrics?.bookmark_count ?? null,
        linkClicks: t.non_public_metrics?.url_link_clicks ?? null,
        profileVisits: t.non_public_metrics?.user_profile_clicks ?? null,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// LinkedIn (member posting via the Posts API)
// ---------------------------------------------------------------------------
export const linkedinProvider: SocialPublishingProvider = {
  platform: "linkedin",
  async publish(userId, text) {
    if (text.length > 3000) throw new IntegrationError("LinkedIn posts are limited to 3,000 characters.");
    const { token, accountId } = await getAccessToken(userId, "linkedin");
    if (!accountId) throw new IntegrationError("Reconnect LinkedIn so we know which profile to post as.", "expired");
    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "LinkedIn-Version": LINKEDIN_API_VERSION(),
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${accountId}`,
        commentary: text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`), // escape LinkedIn "little text" reserved characters
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) throw new IntegrationError("LinkedIn rejected the connection. Reconnect it.", "expired");
    if (res.status !== 201) throw new IntegrationError(`LinkedIn didn't publish the post (HTTP ${res.status}).`);
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!urn) throw new IntegrationError("LinkedIn accepted the request but returned no post ID. Check your profile before retrying.");
    return { postId: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  },
};

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------
function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`;
}

export function buildRfc822(msg: { to: string; from?: string; subject: string; body: string; messageId: string }) {
  if (/[\r\n]/.test(msg.to) || /[\r\n]/.test(msg.subject)) throw new IntegrationError("Invalid characters in recipient or subject.");
  return [
    `To: ${msg.to}`,
    ...(msg.from ? [`From: ${msg.from}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    `Message-ID: <${msg.messageId}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    msg.body,
  ].join("\r\n");
}

export const gmailProvider: EmailProvider = {
  async send(userId, msg) {
    const { token, accountId } = await getAccessToken(userId, "gmail");
    const raw = buildRfc822({
      to: msg.to,
      from: accountId ? (msg.fromName ? `${encodeHeader(msg.fromName)} <${accountId}>` : accountId) : undefined,
      subject: msg.subject,
      body: msg.body,
      messageId: `${randomUUID()}@growth-os`,
    });
    const r = await fetchJson<{ id: string; threadId: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
      timeoutMs: 20000,
    });
    return { messageId: r.id, threadId: r.threadId ?? null };
  },
};

// ---------------------------------------------------------------------------
// Search (Brave Search API)
// ---------------------------------------------------------------------------
export function searchProvider(): ProspectResearchProvider | null {
  const e = env();
  if (!e.SEARCH_API_KEY || (e.SEARCH_PROVIDER ?? "brave") !== "brave") return null;
  return {
    async search(query, count) {
      const r = await fetchJson<{ web?: { results?: { title: string; url: string; description?: string }[] } }>(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}&safesearch=moderate`,
        { headers: { accept: "application/json", "X-Subscription-Token": e.SEARCH_API_KEY! } },
      );
      return (r.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, description: (x.description ?? "").replace(/<[^>]+>/g, "") }));
    },
  };
}

export function publishingProvider(platform: Platform): SocialPublishingProvider {
  return platform === "x" ? xProvider : linkedinProvider;
}
