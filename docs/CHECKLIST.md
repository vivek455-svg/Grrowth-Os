# Implementation checklist

Legend: ✅ done and verified · 🟡 implemented, not verified against the live third-party service · ⬜ not done

## Phase 1 — Foundation
- ✅ Next.js 16 App Router, strict TypeScript, Tailwind v4, shadcn/ui (Radix) design system
- ✅ SQL migrations with RLS on every user table; server-only tables for tokens and OAuth state
- ✅ RLS-scoped data access (`withUser`) shared by local Postgres and Supabase
- ✅ Supabase auth (password + magic link) and an explicit, labelled local demo mode
- ✅ App shell: sidebar navigation, ⌘K global search, quick-create, notifications, account menu

## Phase 2 — Core CRM and content
- ✅ Content items with per-platform versions, repurposing links, tags, pillars, campaigns, ideas
- ✅ Calendar: month / week / list, drag-to-reschedule, filters, quick-add, duplicate, mark published, open URL, performance link
- ✅ Library: table + cards, search, filters, sort, top/bottom quartile, duplicate, repurpose, archive, saved ideas
- ✅ Post editor with manual publishing workflow, metrics snapshots, attribution links
- ✅ Prospects: CRUD, data table with saved views, multi-select bulk actions, duplicate detection
- ✅ CSV import (mapping, validation, duplicate detection, preview, server re-validation) and CSV/JSON export
- ✅ Prospect detail: research, unified timeline, messages, follow-ups, opportunities, campaigns
- ✅ Follow-up manager (overdue, today, 7 days, waiting, gone quiet, interested without next step, stale opportunities)
- ✅ Opportunity pipeline: board (drag between stages) + table, custom stages, multi-touch attribution
- ✅ Campaigns: list with metrics, detail with review queue, cooldown-aware enrolment

## Phase 3 — Analytics
- ✅ Append-only metric snapshots with source labels; follower snapshots
- ✅ Metrics service with documented formulas (`docs/METRICS.md`) and unit tests
- ✅ Overview dashboard, content analytics, reports; 7/30/90/custom ranges; previous-period comparison
- ✅ Outreach filters by channel, campaign and segment

## Phase 4 — AI
- ✅ Provider-agnostic `AIProvider` interface; Anthropic adapter (official SDK, structured outputs, refusal fallback, strict tools) tested with a fake transport
- 🟡 Live AI calls (no API key was available in the build environment)
- ✅ Grounded insights & recommendations engine (deterministic, sample-size gated, evidence stored)
- 🟡 Content Lab (14 modes), AI assist in the editor, regenerate / rewrite selection
- 🟡 Website research summary (deterministic extraction ✅; AI summary 🟡; quote-verification guard ✅ tested)
- 🟡 Personalised outreach (3 variants, claims with sources, validation warnings ✅ tested, portfolio matching)
- 🟡 Growth Assistant with read-only tools (tools ✅ exercised via the no-AI quick questions)
- ✅ Approval required for every externally visible action

## Phase 5 — Integrations
- ✅ OAuth with state + PKCE, encrypted tokens, refresh, revocation on disconnect, error/expired states
- 🟡 X: publish, metrics sync (manual + cron), follower count
- 🟡 LinkedIn: publish text posts
- 🟡 Gmail: send with preview, idempotency and daily limit
- 🟡 Brave Search discovery
- ✅ Website extraction with SSRF guard and robots.txt (unit-tested; live fetch depends on network)
- ✅ Sync job tracking and Integrations page with capabilities, limitations and fallbacks

## Phase 6 — Verification
- ✅ `npm run typecheck`, `npm run lint`, `npm run build` clean
- ✅ 50 Vitest tests incl. DB/RLS integration tests on real Postgres
- ✅ Browser walkthrough of 9 core workflows (`e2e/workflows.mjs`) passing in demo mode
- ✅ All routes render without errors; no horizontal overflow at 390px width

## Known limitations / next steps
- Gmail reply sync needs the restricted `gmail.readonly` scope and Google verification; replies are logged manually today.
- LinkedIn analytics need approval for `r_member_postAnalytics`; until then metrics are entered manually or via CSV.
- X threads and media posts are published manually.
- Only USD is summed in pipeline value; other currencies are listed but not converted.
- Datetime inputs use the browser's local time; a per-user timezone setting is stored but not yet applied to display formatting.
- Notifications are in-app only (no email/push reminders).
