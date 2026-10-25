/**
 * Typed mirror of supabase/migrations. The SQL migrations are the source of truth;
 * tests/schema.test.ts verifies every column declared here exists in the database.
 */
import {
  bigint,
  boolean,
  char,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
// Defaults to auth.uid() in the database, so inserts inside withUser() never pass it explicitly.
const userId = () => uuid("user_id").notNull().default(sql`auth.uid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export type Platform = "x" | "linkedin";
export type Channel = "email" | "linkedin" | "x";
export type MetricSource = "api" | "manual" | "csv" | "estimated";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  fullName: text("full_name"),
  businessName: text("business_name"),
  positioning: text("positioning"),
  services: text("services").array().notNull().default([]),
  targetAudiences: text("target_audiences").array().notNull().default([]),
  writingPreferences: text("writing_preferences"),
  timezone: text("timezone").notNull().default("UTC"),
  engagementRateDenominator: text("engagement_rate_denominator")
    .$type<"impressions" | "followers">()
    .notNull()
    .default("impressions"),
  outreachCooldownDays: integer("outreach_cooldown_days").notNull().default(30),
  dailySendLimit: integer("daily_send_limit").notNull().default(25),
  isDemo: boolean("is_demo").notNull().default(false),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const portfolioProjects = pgTable("portfolio_projects", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  url: text("url"),
  description: text("description"),
  services: text("services").array().notNull().default([]),
  industries: text("industries").array().notNull().default([]),
  verifiedOutcomes: text("verified_outcomes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leadStatuses = pgTable(
  "lead_statuses",
  {
    userId: userId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    category: text("category").$type<"open" | "active" | "won" | "lost" | "excluded">().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    userId: userId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind").$type<"open" | "won" | "lost">().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const savedViews = pgTable("saved_views", {
  id: id(),
  userId: userId(),
  entity: text("entity").$type<"prospects" | "content">().notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

export type IntegrationProviderKey = "x" | "linkedin" | "gmail" | "ai" | "search" | "website_extraction";
export type IntegrationStatus = "disconnected" | "connected" | "error" | "expired";

export const integrations = pgTable("integrations", {
  id: id(),
  userId: userId(),
  provider: text("provider").$type<IntegrationProviderKey>().notNull(),
  status: text("status").$type<IntegrationStatus>().notNull().default("disconnected"),
  scopes: text("scopes").array().notNull().default([]),
  externalAccountId: text("external_account_id"),
  externalAccountName: text("external_account_name"),
  connectedAt: ts("connected_at"),
  lastSyncAt: ts("last_sync_at"),
  lastError: text("last_error"),
  lastErrorAt: ts("last_error_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const integrationCredentials = pgTable("integration_credentials", {
  integrationId: uuid("integration_id").primaryKey(),
  userId: userId(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: ts("expires_at"),
  updatedAt: updatedAt(),
});

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: userId(),
  provider: text("provider").notNull(),
  codeVerifier: text("code_verifier"),
  redirectTo: text("redirect_to"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const syncJobs = pgTable("sync_jobs", {
  id: id(),
  userId: userId(),
  integrationId: uuid("integration_id"),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  status: text("status").$type<"queued" | "running" | "succeeded" | "failed">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  error: text("error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Content OS
// ---------------------------------------------------------------------------
export const contentPillars = pgTable("content_pillars", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const contentCampaigns = pgTable("content_campaigns", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  description: text("description"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: createdAt(),
});

export const contentIdeas = pgTable("content_ideas", {
  id: id(),
  userId: userId(),
  title: text("title").notNull(),
  notes: text("notes"),
  pillarId: uuid("pillar_id"),
  source: text("source").$type<"manual" | "ai" | "insight" | "repurpose">().notNull().default("manual"),
  sourceRef: uuid("source_ref"),
  status: text("status").$type<"open" | "used" | "dismissed">().notNull().default("open"),
  createdAt: createdAt(),
});

export type ContentGoal = "reach" | "authority" | "engagement" | "portfolio_traffic" | "leads" | "sales";

export const contentItems = pgTable("content_items", {
  id: id(),
  userId: userId(),
  title: text("title").notNull(),
  pillarId: uuid("pillar_id"),
  topic: text("topic"),
  keywords: text("keywords").array().notNull().default([]),
  audience: text("audience"),
  goal: text("goal").$type<ContentGoal>(),
  campaignId: uuid("campaign_id"),
  relatedUrl: text("related_url"),
  notes: text("notes"),
  ideaId: uuid("idea_id"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ContentFormat = "text" | "image" | "carousel" | "video" | "link" | "thread";
export type ContentStatus = "idea" | "draft" | "ready" | "scheduled" | "published" | "archived";
export type CtaType = "none" | "follow" | "comment" | "dm" | "link" | "booking" | "other";
export type HookStyle = "question" | "contrarian" | "how_to" | "story" | "list" | "observation" | "data" | "other";

export const contentPlatformVersions = pgTable("content_platform_versions", {
  id: id(),
  userId: userId(),
  contentItemId: uuid("content_item_id").notNull(),
  derivedFromVersionId: uuid("derived_from_version_id"),
  platform: text("platform").$type<Platform>().notNull(),
  format: text("format").$type<ContentFormat>().notNull().default("text"),
  body: text("body").notNull().default(""),
  cta: text("cta"),
  ctaType: text("cta_type").$type<CtaType>(),
  hookStyle: text("hook_style").$type<HookStyle>(),
  status: text("status").$type<ContentStatus>().notNull().default("draft"),
  plannedAt: ts("planned_at"),
  publishedAt: ts("published_at"),
  publishSource: text("publish_source").$type<"api" | "manual">(),
  platformPostId: text("platform_post_id"),
  platformPostUrl: text("platform_post_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contentMetricsSnapshots = pgTable("content_metrics_snapshots", {
  id: id(),
  userId: userId(),
  versionId: uuid("version_id").notNull(),
  capturedAt: ts("captured_at").notNull().defaultNow(),
  impressions: integer("impressions"),
  likes: integer("likes"),
  replies: integer("replies"),
  reposts: integer("reposts"),
  bookmarks: integer("bookmarks"),
  linkClicks: integer("link_clicks"),
  profileVisits: integer("profile_visits"),
  followersGained: integer("followers_gained"),
  meaningfulReplies: integer("meaningful_replies"),
  source: text("source").$type<MetricSource>().notNull(),
  createdAt: createdAt(),
});

export const audienceSnapshots = pgTable("audience_snapshots", {
  id: id(),
  userId: userId(),
  platform: text("platform").$type<Platform>().notNull(),
  capturedAt: ts("captured_at").notNull().defaultNow(),
  followers: integer("followers").notNull(),
  source: text("source").$type<"api" | "manual" | "csv">().notNull(),
  createdAt: createdAt(),
});

export const contentTags = pgTable("content_tags", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
});

export const contentItemTags = pgTable(
  "content_item_tags",
  {
    contentItemId: uuid("content_item_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    userId: userId(),
  },
  (t) => [primaryKey({ columns: [t.contentItemId, t.tagId] })],
);

// ---------------------------------------------------------------------------
// Outreach OS
// ---------------------------------------------------------------------------
export type CampaignChannel = Channel | "mixed";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export const outreachCampaigns = pgTable("outreach_campaigns", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  description: text("description"),
  targetAudience: text("target_audience"),
  criteria: text("criteria"),
  channel: text("channel").$type<CampaignChannel>().notNull(),
  messageStrategy: text("message_strategy"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").$type<CampaignStatus>().notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Priority = "low" | "medium" | "high";

export const prospects = pgTable("prospects", {
  id: id(),
  userId: userId(),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title"),
  company: text("company"),
  companyWebsite: text("company_website"),
  linkedinUrl: text("linkedin_url"),
  xUrl: text("x_url"),
  email: text("email"),
  location: text("location"),
  companyType: text("company_type"),
  industry: text("industry"),
  companySize: text("company_size"),
  source: text("source"),
  persona: text("persona"),
  relevantServices: text("relevant_services").array().notNull().default([]),
  websiteUrl: text("website_url"),
  websiteObservations: text("website_observations"),
  businessProblem: text("business_problem"),
  personalizationNotes: text("personalization_notes"),
  fitScore: integer("fit_score"),
  fitExplanation: text("fit_explanation"),
  priority: text("priority").$type<Priority>().notNull().default("medium"),
  status: text("status").notNull().default("new"),
  preferredChannel: text("preferred_channel").$type<Channel>(),
  tags: text("tags").array().notNull().default([]),
  lastContactedAt: ts("last_contacted_at"),
  nextFollowUpAt: ts("next_follow_up_at"),
  lastInteractionAt: ts("last_interaction_at"),
  domainKey: text("domain_key").generatedAlwaysAs(sql`generated in migration`),
  linkedinKey: text("linkedin_key").generatedAlwaysAs(sql`generated in migration`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const discoveryRuns = pgTable("discovery_runs", {
  id: id(),
  userId: userId(),
  query: text("query").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  provider: text("provider"),
  status: text("status").$type<"draft" | "running" | "completed" | "failed">().notNull().default("draft"),
  error: text("error"),
  createdAt: createdAt(),
});

export type ProspectSourceType =
  | "manual"
  | "csv"
  | "search_api"
  | "social_api"
  | "data_provider"
  | "referral"
  | "inbound";

export const prospectSources = pgTable("prospect_sources", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id"),
  discoveryRunId: uuid("discovery_run_id"),
  sourceType: text("source_type").$type<ProspectSourceType>().notNull(),
  sourceUrl: text("source_url"),
  candidateName: text("candidate_name"),
  candidateCompany: text("candidate_company"),
  candidateTitle: text("candidate_title"),
  candidateWebsite: text("candidate_website"),
  candidateProfileUrl: text("candidate_profile_url"),
  reason: text("reason"),
  evidence: text("evidence"),
  uncertainty: text("uncertainty"),
  reviewStatus: text("review_status")
    .$type<"pending" | "added" | "dismissed" | "duplicate">()
    .notNull()
    .default("pending"),
  createdAt: createdAt(),
});

export type ResearchObservation = {
  text: string;
  kind: "verified" | "hypothesis";
  source_url: string | null;
};

export const prospectResearch = pgTable("prospect_research", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id").notNull(),
  url: text("url"),
  whatTheyDo: text("what_they_do"),
  targetAudience: text("target_audience"),
  valueProposition: text("value_proposition"),
  offerings: text("offerings"),
  primaryCta: text("primary_cta"),
  keySections: text("key_sections").array().notNull().default([]),
  trustSignals: text("trust_signals").array().notNull().default([]),
  observations: jsonb("observations").$type<ResearchObservation[]>().notNull().default([]),
  sources: text("sources").array().notNull().default([]),
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  generatedBy: text("generated_by").$type<"manual" | "extraction" | "ai">().notNull().default("manual"),
  reviewStatus: text("review_status").$type<"draft" | "reviewed">().notNull().default("draft"),
  fetchedAt: ts("fetched_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignProspects = pgTable(
  "campaign_prospects",
  {
    campaignId: uuid("campaign_id").notNull(),
    prospectId: uuid("prospect_id").notNull(),
    userId: userId(),
    state: text("state")
      .$type<"queued" | "drafted" | "approved" | "contacted" | "replied" | "removed">()
      .notNull()
      .default("queued"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.prospectId] })],
);

export const aiGenerationHistory = pgTable("ai_generation_history", {
  id: id(),
  userId: userId(),
  feature: text("feature").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptSummary: text("prompt_summary"),
  output: text("output"),
  status: text("status").$type<"succeeded" | "failed">().notNull(),
  error: text("error"),
  prospectId: uuid("prospect_id"),
  contentItemId: uuid("content_item_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
});

export type MessageStatus =
  | "draft"
  | "approved"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "bounced"
  | "cancelled";
export type MessageVariant = "short" | "value_first" | "relationship" | "custom";
export type MessageKind = "initial" | "follow_up" | "connection_request" | "reply";

export const outreachMessages = pgTable("outreach_messages", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id").notNull(),
  campaignId: uuid("campaign_id"),
  channel: text("channel").$type<Channel>().notNull(),
  kind: text("kind").$type<MessageKind>().notNull().default("initial"),
  variant: text("variant").$type<MessageVariant>(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").$type<MessageStatus>().notNull().default("draft"),
  sendMethod: text("send_method").$type<"api" | "manual">(),
  version: integer("version").notNull().default(1),
  previousVersionId: uuid("previous_version_id"),
  generationId: uuid("generation_id"),
  unsupportedClaims: jsonb("unsupported_claims").$type<string[]>().notNull().default([]),
  idempotencyKey: text("idempotency_key"),
  externalMessageId: text("external_message_id"),
  externalThreadId: text("external_thread_id"),
  error: text("error"),
  approvedAt: ts("approved_at"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id").notNull(),
  channel: text("channel").$type<Channel>().notNull(),
  externalThreadId: text("external_thread_id"),
  syncSource: text("sync_source").$type<"manual" | "synced">().notNull().default("manual"),
  subject: text("subject"),
  externalUrl: text("external_url"),
  lastEventAt: ts("last_event_at"),
  createdAt: createdAt(),
});

export const EVENT_TYPES = [
  "email_sent",
  "email_received",
  "linkedin_sent",
  "linkedin_received",
  "x_dm_sent",
  "x_reply_received",
  "x_public_reply",
  "connection_request_sent",
  "profile_researched",
  "website_audited",
  "follow_up_scheduled",
  "call_booked",
  "note",
  "status_changed",
  "opportunity_created",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type Sentiment = "positive" | "neutral" | "negative" | "opt_out";

export const conversationEvents = pgTable("conversation_events", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id").notNull(),
  conversationId: uuid("conversation_id"),
  type: text("type").$type<EventType>().notNull(),
  channel: text("channel").$type<Channel>(),
  direction: text("direction").$type<"outbound" | "inbound" | "internal">().notNull().default("internal"),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  content: text("content"),
  externalMessageId: text("external_message_id"),
  deliveryStatus: text("delivery_status").$type<"sent" | "delivered" | "failed" | "bounced">(),
  inReplyToEventId: uuid("in_reply_to_event_id"),
  campaignId: uuid("campaign_id"),
  messageId: uuid("message_id"),
  sentiment: text("sentiment").$type<Sentiment>(),
  result: text("result"),
  notes: text("notes"),
  source: text("source").$type<"manual" | "synced" | "system">().notNull().default("manual"),
  createdAt: createdAt(),
});

export const followUps = pgTable("follow_ups", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id").notNull(),
  opportunityId: uuid("opportunity_id"),
  dueAt: ts("due_at").notNull(),
  status: text("status").$type<"pending" | "done" | "skipped" | "cancelled">().notNull().default("pending"),
  reason: text("reason"),
  suggested: boolean("suggested").notNull().default(false),
  completedAt: ts("completed_at"),
  messageId: uuid("message_id"),
  createdAt: createdAt(),
});

export type SourceChannel = "content" | "outreach" | "referral" | "inbound" | "other";

export const opportunities = pgTable("opportunities", {
  id: id(),
  userId: userId(),
  prospectId: uuid("prospect_id"),
  name: text("name").notNull(),
  company: text("company"),
  serviceType: text("service_type"),
  valueCents: bigint("value_cents", { mode: "number" }),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  expectedCloseDate: date("expected_close_date"),
  stage: text("stage").notNull(),
  sourceChannel: text("source_channel").$type<SourceChannel>(),
  outreachCampaignId: uuid("outreach_campaign_id"),
  contentItemId: uuid("content_item_id"),
  nextAction: text("next_action"),
  nextActionAt: ts("next_action_at"),
  outcomeNotes: text("outcome_notes"),
  closedAt: ts("closed_at"),
  lastActivityAt: ts("last_activity_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const opportunityTouchpoints = pgTable("opportunity_touchpoints", {
  id: id(),
  userId: userId(),
  opportunityId: uuid("opportunity_id").notNull(),
  kind: text("kind").$type<SourceChannel>().notNull(),
  contentItemId: uuid("content_item_id"),
  outreachCampaignId: uuid("outreach_campaign_id"),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------
export type Confidence = "low" | "medium" | "high";

export const aiInsights = pgTable("ai_insights", {
  id: id(),
  userId: userId(),
  fingerprint: text("fingerprint").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  sampleSize: integer("sample_size").notNull().default(0),
  confidence: text("confidence").$type<Confidence>().notNull(),
  periodStart: ts("period_start"),
  periodEnd: ts("period_end"),
  status: text("status").$type<"active" | "useful" | "dismissed" | "converted">().notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiRecommendations = pgTable("ai_recommendations", {
  id: id(),
  userId: userId(),
  fingerprint: text("fingerprint").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  reasoning: text("reasoning").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  actionLabel: text("action_label"),
  actionHref: text("action_href"),
  status: text("status").$type<"open" | "done" | "dismissed">().notNull().default("open"),
  statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Compliance & audit
// ---------------------------------------------------------------------------
export const suppressionList = pgTable("suppression_list", {
  id: id(),
  userId: userId(),
  email: text("email"),
  domain: text("domain"),
  linkedinUrl: text("linkedin_url"),
  xHandle: text("x_handle"),
  prospectId: uuid("prospect_id"),
  reason: text("reason").$type<"opt_out" | "do_not_contact" | "bounced" | "manual">().notNull().default("opt_out"),
  createdAt: createdAt(),
});

export const activityLogs = pgTable("activity_logs", {
  id: id(),
  userId: userId(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export type Prospect = typeof prospects.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type ContentVersion = typeof contentPlatformVersions.$inferSelect;
export type MetricsSnapshot = typeof contentMetricsSnapshots.$inferSelect;
export type OutreachMessage = typeof outreachMessages.$inferSelect;
export type ConversationEvent = typeof conversationEvents.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
