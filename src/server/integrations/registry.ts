import "server-only";
import { env } from "@/lib/env";
import type { IntegrationProviderKey } from "@/db/schema";

/**
 * What each integration can and cannot do, verified against provider docs (Oct 2026).
 * The UI renders this verbatim so users never assume a capability that doesn't exist.
 */
export type Capability = { label: string; available: boolean; note?: string };

export type IntegrationDef = {
  key: IntegrationProviderKey;
  name: string;
  description: string;
  kind: "oauth" | "env";
  scopes: string[];
  capabilities: Capability[];
  limitations: string[];
  fallback: string;
  envVars: string[];
  configured: () => boolean;
  docsUrl: string;
};

export const LINKEDIN_API_VERSION = () => process.env.LINKEDIN_API_VERSION ?? "202606";

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: "x",
    name: "X",
    description: "Publish approved posts and sync metrics for your own posts.",
    kind: "oauth",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    capabilities: [
      { label: "Publish a post you approve", available: true },
      { label: "Sync public metrics (impressions, likes, replies, reposts, bookmarks)", available: true },
      { label: "Sync link clicks and profile visits", available: true, note: "Only for posts from the last 30 days (X API limit)" },
      { label: "Follower count", available: true },
      { label: "Scheduled publishing", available: false, note: "The API publishes immediately; schedule in the calendar and publish when due" },
      { label: "Read or send DMs", available: false, note: "Not enabled — use copy & open, then log the message" },
    ],
    limitations: ["X API is pay-per-use: each post created and post read costs credits on your X developer account.", "Threads are published as a single post; publish threads manually."],
    fallback: "Copy the post, publish on X, then record the URL and metrics manually.",
    envVars: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    configured: () => Boolean(env().X_CLIENT_ID && env().X_CLIENT_SECRET),
    docsUrl: "https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    description: "Publish approved text posts to your personal profile.",
    kind: "oauth",
    scopes: ["openid", "profile", "email", "w_member_social"],
    capabilities: [
      { label: "Publish a text post you approve", available: true },
      { label: "Post analytics", available: false, note: "Requires LinkedIn's restricted r_member_postAnalytics approval — record metrics manually or via CSV" },
      { label: "Read or send messages", available: false, note: "Not available through LinkedIn's APIs — use copy & open, then log it" },
      { label: "Connection requests", available: false, note: "Not available — send from LinkedIn and log it" },
    ],
    limitations: ["Access tokens last about 60 days; reconnect when prompted.", "Images, carousels and documents are published manually."],
    fallback: "Copy the post or message, open LinkedIn, send it yourself, then log it here.",
    envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_API_VERSION (optional)"],
    configured: () => Boolean(env().LINKEDIN_CLIENT_ID && env().LINKEDIN_CLIENT_SECRET),
    docsUrl: "https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin",
  },
  {
    key: "gmail",
    name: "Gmail",
    description: "Send approved outreach emails from your Gmail account.",
    kind: "oauth",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
    capabilities: [
      { label: "Send an approved email (with preview and confirmation)", available: true },
      { label: "Thread tracking for sent emails", available: true, note: "Message and thread IDs are stored" },
      { label: "Read replies automatically", available: false, note: "Needs Google's restricted gmail.readonly scope — log replies manually" },
      { label: "Open/click tracking", available: false, note: "Not implemented by design (unreliable and privacy-invasive)" },
    ],
    limitations: ["gmail.send is a sensitive scope: Google shows an 'unverified app' screen until your OAuth app is verified.", "Daily send limit is enforced from Settings."],
    fallback: "Copy the email into your mail client, send it, then mark it as sent here.",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    configured: () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET),
    docsUrl: "https://developers.google.com/workspace/gmail/api/auth/scopes",
  },
  {
    key: "ai",
    name: "AI provider",
    description: "Drafting, research summaries, personalization and the Growth Assistant.",
    kind: "env",
    scopes: [],
    capabilities: [
      { label: "Content Lab and repurposing", available: true },
      { label: "Website research summaries", available: true },
      { label: "Personalized outreach drafts", available: true },
      { label: "Growth Assistant (read-only data tools)", available: true },
    ],
    limitations: ["AI output is always a draft. Nothing is published or sent without your approval.", `Limited to 60 generations per hour per user.`],
    fallback: "Every workflow has a manual path; AI only speeds up drafting.",
    envVars: ["ANTHROPIC_API_KEY", "AI_MODEL (optional, default claude-opus-5-5)"],
    configured: () => Boolean(env().ANTHROPIC_API_KEY),
    docsUrl: "https://docs.claude.com",
  },
  {
    key: "search",
    name: "Search API (Brave)",
    description: "Find businesses and public pages for prospect discovery.",
    kind: "env",
    scopes: [],
    capabilities: [
      { label: "Web search for companies and public pages", available: true },
      { label: "Contact details / emails", available: false, note: "Never inferred. Add only emails a person published or shared with you" },
    ],
    limitations: ["Results are candidates to review, not verified leads.", "Subject to your Brave Search API plan limits."],
    fallback: "Import a CSV you're allowed to use, or add prospects manually.",
    envVars: ["SEARCH_PROVIDER=brave", "SEARCH_API_KEY"],
    configured: () => Boolean(env().SEARCH_API_KEY && (env().SEARCH_PROVIDER ?? "brave") === "brave"),
    docsUrl: "https://api-dashboard.search.brave.com/app/documentation/web-search/get-started",
  },
  {
    key: "website_extraction",
    name: "Website extraction",
    description: "Built-in, single-page fetch of public business websites for research.",
    kind: "env",
    scopes: [],
    capabilities: [
      { label: "Extract title, headings, CTAs and trust signals", available: true },
      { label: "Respects robots.txt; blocks private networks", available: true },
      { label: "Crawling multiple pages", available: false, note: "By design — only the URL you choose is fetched" },
    ],
    limitations: ["Pages that render content only with JavaScript may extract little text."],
    fallback: "Write observations manually in the Research tab.",
    envVars: [],
    configured: () => true,
    docsUrl: "",
  },
];

export function integrationDef(key: string) {
  return INTEGRATIONS.find((i) => i.key === key) ?? null;
}
