-- Growth OS: initial schema
-- Conventions
--   * Every user-owned table has user_id (defaults to auth.uid()) and RLS restricting rows to the owner.
--   * Timestamps are timestamptz (UTC). External provider ids are stored in dedicated columns.
--   * Metrics are stored as append-only snapshots; nulls mean "not available", never zero.
--   * Secrets (OAuth tokens, PKCE verifiers) live in tables with RLS enabled and no client policies,
--     so only the server (database owner / service role) can read them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & workspace configuration
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  business_name text,
  positioning text,
  services text[] not null default '{}',
  target_audiences text[] not null default '{}',
  writing_preferences text,
  timezone text not null default 'UTC',
  engagement_rate_denominator text not null default 'impressions'
    check (engagement_rate_denominator in ('impressions', 'followers')),
  outreach_cooldown_days integer not null default 30 check (outreach_cooldown_days between 0 and 365),
  daily_send_limit integer not null default 25 check (daily_send_limit between 0 and 500),
  is_demo boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  url text,
  description text,
  services text[] not null default '{}',
  industries text[] not null default '{}',
  -- Only results the user has verified. The AI is instructed never to invent outcomes.
  verified_outcomes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portfolio_projects_user_idx on public.portfolio_projects (user_id);

create table public.lead_statuses (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null,
  category text not null default 'open'
    check (category in ('open', 'active', 'won', 'lost', 'excluded')),
  sort_order integer not null default 0,
  is_system boolean not null default false,
  primary key (user_id, key)
);

create table public.pipeline_stages (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null,
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  sort_order integer not null default 0,
  primary key (user_id, key)
);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  entity text not null check (entity in ('prospects', 'content')),
  name text not null,
  filters jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index saved_views_user_idx on public.saved_views (user_id, entity);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('x', 'linkedin', 'gmail', 'ai', 'search', 'website_extraction')),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error', 'expired')),
  scopes text[] not null default '{}',
  external_account_id text,
  external_account_name text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Server-only: encrypted tokens. RLS enabled, no policies for client roles.
create table public.integration_credentials (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Server-only: OAuth state + PKCE verifier, single use, short lived.
create table public.oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  code_verifier text,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  provider text not null,
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  idempotency_key text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index sync_jobs_user_idx on public.sync_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Content OS
-- ---------------------------------------------------------------------------
create table public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  description text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.content_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  notes text,
  pillar_id uuid references public.content_pillars (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'ai', 'insight', 'repurpose')),
  source_ref uuid,
  status text not null default 'open' check (status in ('open', 'used', 'dismissed')),
  created_at timestamptz not null default now()
);
create index content_ideas_user_idx on public.content_ideas (user_id, status);

-- The original idea / brief. Platform-specific posts live in content_platform_versions.
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  pillar_id uuid references public.content_pillars (id) on delete set null,
  topic text,
  keywords text[] not null default '{}',
  audience text,
  goal text check (goal in ('reach', 'authority', 'engagement', 'portfolio_traffic', 'leads', 'sales')),
  campaign_id uuid references public.content_campaigns (id) on delete set null,
  related_url text,
  notes text,
  idea_id uuid references public.content_ideas (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_user_idx on public.content_items (user_id, created_at desc);
create index content_items_pillar_idx on public.content_items (pillar_id);
create index content_items_keywords_idx on public.content_items using gin (keywords);

create table public.content_platform_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  -- Set when this version was repurposed from another version.
  derived_from_version_id uuid references public.content_platform_versions (id) on delete set null,
  platform text not null check (platform in ('x', 'linkedin')),
  format text not null default 'text' check (format in ('text', 'image', 'carousel', 'video', 'link', 'thread')),
  body text not null default '',
  cta text,
  cta_type text check (cta_type in ('none', 'follow', 'comment', 'dm', 'link', 'booking', 'other')),
  hook_style text check (hook_style in ('question', 'contrarian', 'how_to', 'story', 'list', 'observation', 'data', 'other')),
  status text not null default 'draft' check (status in ('idea', 'draft', 'ready', 'scheduled', 'published', 'archived')),
  planned_at timestamptz,
  published_at timestamptz,
  -- How publication was confirmed: by the platform API or recorded manually by the user.
  publish_source text check (publish_source in ('api', 'manual')),
  platform_post_id text,
  platform_post_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or (published_at is not null and publish_source is not null)),
  check (status <> 'scheduled' or planned_at is not null)
);
create index cpv_user_planned_idx on public.content_platform_versions (user_id, planned_at);
create index cpv_user_published_idx on public.content_platform_versions (user_id, published_at);
create index cpv_item_idx on public.content_platform_versions (content_item_id);
create unique index cpv_platform_post_uidx
  on public.content_platform_versions (user_id, platform, platform_post_id)
  where platform_post_id is not null;

create table public.content_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  version_id uuid not null references public.content_platform_versions (id) on delete cascade,
  captured_at timestamptz not null default now(),
  impressions integer check (impressions >= 0),
  likes integer check (likes >= 0),
  replies integer check (replies >= 0),
  reposts integer check (reposts >= 0),
  bookmarks integer check (bookmarks >= 0),
  link_clicks integer check (link_clicks >= 0),
  profile_visits integer check (profile_visits >= 0),
  followers_gained integer,
  meaningful_replies integer check (meaningful_replies >= 0),
  source text not null check (source in ('api', 'manual', 'csv', 'estimated')),
  created_at timestamptz not null default now()
);
create index cms_version_idx on public.content_metrics_snapshots (version_id, captured_at desc);
create index cms_user_idx on public.content_metrics_snapshots (user_id, captured_at desc);

create table public.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('x', 'linkedin')),
  captured_at timestamptz not null default now(),
  followers integer not null check (followers >= 0),
  source text not null check (source in ('api', 'manual', 'csv')),
  created_at timestamptz not null default now()
);
create index audience_snapshots_idx on public.audience_snapshots (user_id, platform, captured_at);

create table public.content_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 50),
  unique (user_id, name)
);

create table public.content_item_tags (
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  tag_id uuid not null references public.content_tags (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  primary key (content_item_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Outreach OS
-- ---------------------------------------------------------------------------
create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text,
  target_audience text,
  criteria text,
  channel text not null check (channel in ('email', 'linkedin', 'x', 'mixed')),
  message_strategy text,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  job_title text,
  company text,
  company_website text,
  linkedin_url text,
  x_url text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  location text,
  company_type text,
  industry text,
  company_size text,
  source text,
  persona text,
  relevant_services text[] not null default '{}',
  website_url text,
  website_observations text,
  business_problem text,
  personalization_notes text,
  fit_score integer check (fit_score between 0 and 100),
  fit_explanation text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'new',
  preferred_channel text check (preferred_channel in ('email', 'linkedin', 'x')),
  tags text[] not null default '{}',
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  last_interaction_at timestamptz,
  -- Normalised keys used for duplicate detection.
  domain_key text generated always as (
    nullif(regexp_replace(lower(coalesce(company_website, website_url, '')), '^(https?://)?(www\.)?([^/?#]+).*$', '\3'), '')
  ) stored,
  linkedin_key text generated always as (
    nullif(regexp_replace(lower(coalesce(linkedin_url, '')), '^(https?://)?([a-z]+\.)?linkedin\.com/in/([^/?#]+).*$', '\3'), lower(coalesce(linkedin_url, '')))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, status) references public.lead_statuses (user_id, key) on update cascade
);
create index prospects_user_idx on public.prospects (user_id, created_at desc);
create index prospects_status_idx on public.prospects (user_id, status);
create index prospects_followup_idx on public.prospects (user_id, next_follow_up_at);
create index prospects_domain_idx on public.prospects (user_id, domain_key);
create index prospects_tags_idx on public.prospects using gin (tags);
create unique index prospects_email_uidx on public.prospects (user_id, lower(email)) where email is not null;
create unique index prospects_linkedin_uidx on public.prospects (user_id, linkedin_key) where linkedin_key is not null;

create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  query text not null,
  config jsonb not null default '{}',
  provider text,
  status text not null default 'draft' check (status in ('draft', 'running', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- Where a prospect (or discovery candidate) came from, with evidence and uncertainty.
create table public.prospect_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete cascade,
  discovery_run_id uuid references public.discovery_runs (id) on delete cascade,
  source_type text not null check (source_type in ('manual', 'csv', 'search_api', 'social_api', 'data_provider', 'referral', 'inbound')),
  source_url text,
  candidate_name text,
  candidate_company text,
  candidate_title text,
  candidate_website text,
  candidate_profile_url text,
  reason text,
  evidence text,
  uncertainty text,
  review_status text not null default 'pending' check (review_status in ('pending', 'added', 'dismissed', 'duplicate')),
  created_at timestamptz not null default now()
);
create index prospect_sources_prospect_idx on public.prospect_sources (prospect_id);
create index prospect_sources_run_idx on public.prospect_sources (discovery_run_id);

create table public.prospect_research (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  url text,
  what_they_do text,
  target_audience text,
  value_proposition text,
  offerings text,
  primary_cta text,
  key_sections text[] not null default '{}',
  trust_signals text[] not null default '{}',
  -- [{ "text": string, "kind": "verified" | "hypothesis", "source_url": string | null }]
  observations jsonb not null default '[]',
  sources text[] not null default '{}',
  extracted jsonb,
  generated_by text not null default 'manual' check (generated_by in ('manual', 'extraction', 'ai')),
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed')),
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prospect_research_prospect_idx on public.prospect_research (prospect_id, created_at desc);

create table public.campaign_prospects (
  campaign_id uuid not null references public.outreach_campaigns (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'drafted', 'approved', 'contacted', 'replied', 'removed')),
  added_at timestamptz not null default now(),
  primary key (campaign_id, prospect_id)
);
create index campaign_prospects_prospect_idx on public.campaign_prospects (prospect_id);

create table public.ai_generation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  feature text not null,
  provider text not null,
  model text not null,
  prompt_summary text,
  output text,
  status text not null check (status in ('succeeded', 'failed')),
  error text,
  prospect_id uuid references public.prospects (id) on delete set null,
  content_item_id uuid references public.content_items (id) on delete set null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index ai_generation_history_user_idx on public.ai_generation_history (user_id, created_at desc);

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  channel text not null check (channel in ('email', 'linkedin', 'x')),
  kind text not null default 'initial' check (kind in ('initial', 'follow_up', 'connection_request', 'reply')),
  variant text check (variant in ('short', 'value_first', 'relationship', 'custom')),
  subject text,
  body text not null,
  -- sent = confirmed by provider API or recorded manually by the user (see send_method)
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'cancelled')),
  send_method text check (send_method in ('api', 'manual')),
  version integer not null default 1,
  previous_version_id uuid references public.outreach_messages (id) on delete set null,
  generation_id uuid references public.ai_generation_history (id) on delete set null,
  unsupported_claims jsonb not null default '[]',
  idempotency_key text,
  external_message_id text,
  external_thread_id text,
  error text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (status not in ('sent', 'delivered') or (sent_at is not null and send_method is not null)),
  check (status not in ('approved', 'sending', 'sent', 'delivered') or approved_at is not null)
);
create index outreach_messages_prospect_idx on public.outreach_messages (prospect_id, created_at desc);
create index outreach_messages_user_status_idx on public.outreach_messages (user_id, status);
create index outreach_messages_campaign_idx on public.outreach_messages (campaign_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  channel text not null check (channel in ('email', 'linkedin', 'x')),
  external_thread_id text,
  sync_source text not null default 'manual' check (sync_source in ('manual', 'synced')),
  subject text,
  external_url text,
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create index conversations_prospect_idx on public.conversations (prospect_id);
create unique index conversations_thread_uidx
  on public.conversations (user_id, channel, external_thread_id) where external_thread_id is not null;

-- Unified activity timeline. Manual entries are distinguished from synced ones via `source`.
create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  type text not null check (type in (
    'email_sent', 'email_received', 'linkedin_sent', 'linkedin_received', 'x_dm_sent', 'x_reply_received',
    'x_public_reply', 'connection_request_sent', 'profile_researched', 'website_audited', 'follow_up_scheduled',
    'call_booked', 'note', 'status_changed', 'opportunity_created'
  )),
  channel text check (channel in ('email', 'linkedin', 'x')),
  direction text not null default 'internal' check (direction in ('outbound', 'inbound', 'internal')),
  occurred_at timestamptz not null default now(),
  content text,
  external_message_id text,
  delivery_status text check (delivery_status in ('sent', 'delivered', 'failed', 'bounced')),
  in_reply_to_event_id uuid references public.conversation_events (id) on delete set null,
  campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  message_id uuid references public.outreach_messages (id) on delete set null,
  -- Reply classification used by positive-reply metrics. Set by the user (or confirmed AI suggestion).
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'opt_out')),
  result text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'synced', 'system')),
  created_at timestamptz not null default now()
);
create index conversation_events_prospect_idx on public.conversation_events (prospect_id, occurred_at desc);
create index conversation_events_user_idx on public.conversation_events (user_id, occurred_at desc);
create index conversation_events_type_idx on public.conversation_events (user_id, type, occurred_at);
create unique index conversation_events_external_uidx
  on public.conversation_events (user_id, external_message_id) where external_message_id is not null;

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  opportunity_id uuid,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'cancelled')),
  reason text,
  suggested boolean not null default false,
  completed_at timestamptz,
  message_id uuid references public.outreach_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  check (status <> 'done' or completed_at is not null)
);
create index follow_ups_user_due_idx on public.follow_ups (user_id, status, due_at);
create index follow_ups_prospect_idx on public.follow_ups (prospect_id);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  company text,
  service_type text,
  value_cents bigint check (value_cents >= 0),
  currency char(3) not null default 'USD',
  expected_close_date date,
  stage text not null,
  source_channel text check (source_channel in ('content', 'outreach', 'referral', 'inbound', 'other')),
  outreach_campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  content_item_id uuid references public.content_items (id) on delete set null,
  next_action text,
  next_action_at timestamptz,
  outcome_notes text,
  closed_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, stage) references public.pipeline_stages (user_id, key) on update cascade
);
create index opportunities_user_stage_idx on public.opportunities (user_id, stage);
create index opportunities_prospect_idx on public.opportunities (prospect_id);

alter table public.follow_ups
  add constraint follow_ups_opportunity_fk foreign key (opportunity_id) references public.opportunities (id) on delete cascade;

-- Multi-touch attribution. Recording a touchpoint is attribution, not proof of causation.
create table public.opportunity_touchpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  kind text not null check (kind in ('content', 'outreach', 'referral', 'inbound', 'other')),
  content_item_id uuid references public.content_items (id) on delete set null,
  outreach_campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index opportunity_touchpoints_opp_idx on public.opportunity_touchpoints (opportunity_id);

-- ---------------------------------------------------------------------------
-- AI insights & recommendations (grounded in stored data; evidence is persisted)
-- ---------------------------------------------------------------------------
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  fingerprint text not null,
  kind text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '{}',
  sample_size integer not null default 0,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  period_start timestamptz,
  period_end timestamptz,
  status text not null default 'active' check (status in ('active', 'useful', 'dismissed', 'converted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  fingerprint text not null,
  kind text not null,
  title text not null,
  reasoning text not null,
  evidence jsonb not null default '{}',
  action_label text,
  action_href text,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

-- ---------------------------------------------------------------------------
-- Compliance & audit
-- ---------------------------------------------------------------------------
create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  email text,
  domain text,
  linkedin_url text,
  x_handle text,
  prospect_id uuid references public.prospects (id) on delete set null,
  reason text not null default 'opt_out' check (reason in ('opt_out', 'do_not_contact', 'bounced', 'manual')),
  created_at timestamptz not null default now(),
  check (coalesce(email, domain, linkedin_url, x_handle) is not null or prospect_id is not null)
);
create index suppression_user_idx on public.suppression_list (user_id);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_user_idx on public.activity_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'portfolio_projects', 'integrations', 'content_items', 'content_platform_versions',
    'outreach_campaigns', 'prospects', 'prospect_research', 'outreach_messages', 'opportunities',
    'ai_insights', 'ai_recommendations'
  ] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Defaults for new users
-- ---------------------------------------------------------------------------
create or replace function public.seed_workspace_defaults(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lead_statuses (user_id, key, label, category, sort_order, is_system) values
    (p_user, 'new', 'New', 'open', 10, true),
    (p_user, 'researched', 'Researched', 'open', 20, true),
    (p_user, 'qualified', 'Qualified', 'open', 30, true),
    (p_user, 'ready', 'Ready for outreach', 'open', 40, true),
    (p_user, 'contacted', 'Contacted', 'active', 50, true),
    (p_user, 'replied', 'Replied', 'active', 60, true),
    (p_user, 'interested', 'Interested', 'active', 70, true),
    (p_user, 'call_booked', 'Call booked', 'active', 80, true),
    (p_user, 'proposal_sent', 'Proposal sent', 'active', 90, true),
    (p_user, 'won', 'Won', 'won', 100, true),
    (p_user, 'lost', 'Lost', 'lost', 110, true),
    (p_user, 'not_a_fit', 'Not a fit', 'excluded', 120, true),
    (p_user, 'do_not_contact', 'Do not contact', 'excluded', 130, true)
  on conflict do nothing;

  insert into public.pipeline_stages (user_id, key, label, kind, sort_order) values
    (p_user, 'qualified', 'Qualified', 'open', 10),
    (p_user, 'contacted', 'Contacted', 'open', 20),
    (p_user, 'engaged', 'Engaged', 'open', 30),
    (p_user, 'discovery_call', 'Discovery call', 'open', 40),
    (p_user, 'proposal', 'Proposal', 'open', 50),
    (p_user, 'negotiation', 'Negotiation', 'open', 60),
    (p_user, 'won', 'Won', 'won', 70),
    (p_user, 'lost', 'Lost', 'lost', 80)
  on conflict do nothing;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  perform public.seed_workspace_defaults(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'portfolio_projects', 'lead_statuses', 'pipeline_stages', 'saved_views', 'integrations', 'sync_jobs',
    'content_pillars', 'content_campaigns', 'content_ideas', 'content_items', 'content_platform_versions',
    'content_metrics_snapshots', 'audience_snapshots', 'content_tags', 'content_item_tags',
    'outreach_campaigns', 'prospects', 'discovery_runs', 'prospect_sources', 'prospect_research',
    'campaign_prospects', 'ai_generation_history', 'outreach_messages', 'conversations',
    'conversation_events', 'follow_ups', 'opportunities', 'opportunity_touchpoints', 'ai_insights',
    'ai_recommendations', 'suppression_list'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;

-- Audit log: insert + read only. No update/delete for client roles.
alter table public.activity_logs enable row level security;
create policy activity_logs_select on public.activity_logs for select to authenticated using (user_id = auth.uid());
create policy activity_logs_insert on public.activity_logs for insert to authenticated with check (user_id = auth.uid());

-- Server-only tables: RLS on, no client policies.
alter table public.integration_credentials enable row level security;
alter table public.oauth_states enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.integration_credentials, public.oauth_states from authenticated, anon;
revoke update, delete on public.activity_logs from authenticated;
