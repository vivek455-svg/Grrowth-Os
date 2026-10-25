# Growth OS

A personal content-intelligence and outreach CRM for an independent web designer / Framer Expert.
One workspace for:

- **Content OS** — plan, write, publish (or record) and analyse posts on X and LinkedIn.
- **Outreach OS** — find and research prospects, write genuinely personal outreach, track every
  conversation, follow-up and opportunity.
- **AI Growth Assistant** — grounded recommendations, drafting help, and answers about your real data.

Everything works without external APIs: integrations add automation, but every feature has a manual path.

---

## Quick start (local demo)

Requirements: Node 22+, PostgreSQL 15+ (local).

```bash
npm install
cp .env.example .env.local
# edit .env.local:
#   DATABASE_URL=postgres://<user>:<pass>@localhost:5432/growth_os
#   DEMO_MODE=true
#   TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
createdb growth_os
npm run db:reset-local   # applies migrations + seeds the clearly-labelled demo workspace
npm run dev              # http://localhost:3000
```

Demo mode signs you in as a fixed demo user. It is **ignored whenever Supabase is configured**, the seed
script refuses to run when Supabase env vars are present, and all sample companies use the reserved
`.example` domain so nothing can be mistaken for (or sent to) a real business.

## Production setup (Supabase + Vercel or any Node host)

1. **Create a Supabase project.** Enable Email auth (password and/or magic link). Add
   `${APP_URL}/auth/callback` to the redirect allow-list.
2. **Apply migrations** — either `supabase link && supabase db push`, or
   `MIGRATE_SKIP_SHIM=1 DATABASE_URL=<direct connection> npm run db:migrate`.
   Never apply `supabase/local-shim.sql` to Supabase (the migration script skips it with that flag).
3. **Set environment variables** (see `.env.example`). Use the Supabase *pooler* connection string
   (transaction mode) for `DATABASE_URL`.
4. **Deploy.** `npm run build && npm start`, or deploy to Vercel. `vercel.json` schedules the daily
   metrics sync; set `CRON_SECRET` to enable it.
5. **Optional integrations** — register OAuth apps and set their keys (below).

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection (server only) |
| `APP_URL` | yes | Public URL, used for OAuth redirects |
| `TOKEN_ENCRYPTION_KEY` | for integrations | Encrypts OAuth tokens (AES-256-GCM) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | Authentication |
| `DEMO_MODE` | no | `true` for the local demo workspace |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | no | AI features (default model `claude-opus-5-5`) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | no | X publishing + metrics sync |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_API_VERSION` | no | LinkedIn publishing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Gmail sending |
| `SEARCH_PROVIDER`, `SEARCH_API_KEY` | no | Prospect discovery (Brave Search API) |
| `CRON_SECRET` | no | Protects `GET /api/cron/sync` |

No secret is ever sent to the browser: only `NEXT_PUBLIC_SUPABASE_*` are public, and the anon key is
safe by design (RLS).

## Architecture

```
src/
  app/                 Next.js App Router (routes, route handlers)
    (app)/             Authenticated workspace (layout = sidebar + header)
    api/               Exports, OAuth connect/callback, cron
  components/          UI, built from shadcn/ui primitives in components/ui
  db/schema.ts         Typed Drizzle mirror of the SQL migrations
  db/client.ts         withUser() — every query runs in a transaction as role `authenticated`
                       with the user's JWT claims, so Postgres RLS enforces ownership
  lib/metrics/         Metrics service (pure, unit-tested)
  lib/insights/        Grounded insight + recommendation engine (pure, unit-tested)
  lib/domain/          Outreach safety rules, CSV import validation, research guards
  server/action.ts     defineAction(): auth + Zod validation + RLS transaction + safe errors
  server/actions/      Server actions per domain (content, prospects, pipeline, sending, AI…)
  server/queries/      Read models for pages
  server/ai/           Provider-agnostic AI interface, Anthropic adapter, prompts, budget/logging
  server/integrations/ OAuth (PKCE, encrypted tokens), provider interfaces, website fetcher, sync jobs
supabase/migrations/   Source-of-truth SQL schema with RLS
scripts/               migrate, seed-demo, reset-local-db
tests/                 Vitest: metrics, rules, insights, imports, safety, AI adapter, DB/RLS
e2e/workflows.mjs      Browser walkthrough of the core workflows (Playwright)
```

**Data access.** Server components and actions never use a privileged connection for user data.
`withUser()` sets `request.jwt.claims` and `SET LOCAL ROLE authenticated`, so the same RLS policies
apply locally and on Supabase. `asService()` (privileged) is used only for server-only tables
(encrypted credentials, OAuth state) and cron.

**AI.** `src/server/ai/types.ts` defines `AIProvider` (`generateObject`, `runWithTools`). The Anthropic
adapter uses the official SDK with structured outputs, server-side refusal fallback, and strict tools.
To add another provider, implement the interface and register it in `src/server/ai/index.ts`.
AI calls run outside database transactions, are limited to 60/hour/user, and are logged in
`ai_generation_history` (inputs summarised, not stored verbatim). External content (websites, imports,
prospect fields) is wrapped as untrusted data in prompts.

**Integrations.** Each integration is described in `src/server/integrations/registry.ts` (capabilities,
limitations, fallback) and implemented behind interfaces in `providers.ts`:
`SocialPublishingProvider`, `SocialAnalyticsProvider`, `EmailProvider`, `MessagingProvider`,
`ProspectResearchProvider`, plus `AIProvider`.

| Integration | Implemented | Not available (by design or API limits) |
|---|---|---|
| X (OAuth 2.0 PKCE) | Publish approved text posts; sync own posts + public metrics; link clicks / profile visits for posts < 30 days; follower count | DMs; threads (publish manually). X API is pay-per-use. |
| LinkedIn (OIDC + `w_member_social`) | Publish approved text posts via `/rest/posts` | Post analytics (needs restricted `r_member_postAnalytics`), messaging, connection requests |
| Gmail (`gmail.send`) | Send approved emails with preview + confirmation; thread ids stored | Reading replies (needs restricted `gmail.readonly`); open/click tracking |
| Brave Search | Discovery candidates from public pages | Emails/contact details are never collected or inferred |
| Website extraction | One public page; robots.txt respected; SSRF-guarded | Crawling |

Where an API isn't available the app offers copy-and-open plus manual logging, and labels manually
recorded data (“Logged manually”, metric source “Manual”) separately from synced data.

## Outreach safeguards

- Every message is a draft until **you approve it**; sends show a preview and require confirmation.
- Approval/sending re-checks: suppression list, opt-outs, “do not contact”, duplicate-contact cooldown,
  “they replied after your last message” (blocks follow-ups), missing contact details.
- Gmail sends are idempotent (atomic `approved → sending` claim, external id stored before retry is
  allowed) and limited per day (Settings).
- An inbound reply cancels pending follow-ups; an opt-out adds the prospect to the suppression list.
- Campaign enrolment never sends anything; there is no bulk send.
- Sends, publications, deletions, imports and integration changes go to an append-only audit log.

## Security

Auth (Supabase), RLS on every user table (verified by `tests/db.test.ts`), server-side Zod validation,
OAuth state + PKCE, encrypted tokens with revocation on disconnect, DB-backed rate limits (AI, website
research, email sends), SSRF protection and robots.txt for website fetches, security headers, structured
logs with secret redaction, safe user-facing errors, formula-injection-safe CSV exports, full JSON export
and account deletion (Settings → Data).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (set `TEST_DATABASE_URL` to also run the DB/RLS tests; the DB is recreated) |
| `npm run db:migrate` | Apply migrations (`MIGRATE_SKIP_SHIM=1` for Supabase) |
| `npm run db:reset-local` | Recreate the local DB, migrate, seed the demo workspace |
| `node e2e/workflows.mjs` | Browser walkthrough of core workflows against a running demo app |

See `docs/METRICS.md` for every formula and `docs/CHECKLIST.md` for implementation status.
