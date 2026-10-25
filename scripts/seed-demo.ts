/**
 * Seeds the DEMO workspace with clearly-labelled sample data.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-demo.ts [--reset]
 *
 * Safety: only ever writes to the fixed demo user id, refuses to run when Supabase auth is
 * configured, and marks the profile `is_demo`. Companies use the reserved `.example` TLD so
 * no sample record can be mistaken for (or sent to) a real business.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as s from "../src/db/schema";

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DAY = 86400000;

// Deterministic PRNG so the demo looks the same on every machine.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

export async function seedDemo(databaseUrl: string, { reset = false } = {}) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Refusing to seed demo data while Supabase auth is configured.");
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: s });
  seed = 42;
  try {
    if (reset) await db.execute(sql`delete from auth.users where id = ${DEMO_USER_ID}`);
    await db.execute(sql`insert into auth.users (id, email) values (${DEMO_USER_ID}, 'demo@growth-os.local') on conflict do nothing`);
    const [existing] = await db.execute<{ n: number }>(sql`select count(*)::int as n from content_items where user_id = ${DEMO_USER_ID}`);
    if (existing && existing.n > 0) {
      console.log("Demo workspace already has data. Use --reset to recreate it.");
      return;
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: DEMO_USER_ID })}, true)`);
      await tx.execute(sql`set local role authenticated`);
      const now = Date.now();
      const daysAgo = (n: number, h = 9) => new Date(Math.floor((now - n * DAY) / DAY) * DAY + h * 3600000);

      await tx
        .update(s.profiles)
        .set({
          fullName: "Demo Designer",
          businessName: "Demo Studio",
          positioning:
            "Official Framer Expert. I design and build conversion-focused landing pages for B2B SaaS companies, startups and design agencies.",
          services: [
            "Conversion-focused landing pages",
            "Framer website design & development",
            "Figma-to-Framer implementation",
            "Framer migrations",
            "Agency Framer development partnerships",
          ],
          targetAudiences: ["B2B SaaS founders", "Startup marketing leads", "Design agencies and studios"],
          writingPreferences: "Short sentences. Specific observations. No hype. One idea per post.",
          isDemo: true,
          onboardingCompletedAt: new Date(),
        })
        .where(sql`id = ${DEMO_USER_ID}`);

      await tx.insert(s.portfolioProjects).values([
        {
          name: "Ledgerline — SaaS homepage (sample)",
          url: "https://ledgerline.example",
          description: "Homepage redesign and Framer build for a fintech SaaS.",
          services: ["Conversion-focused landing pages", "Framer website design & development"],
          industries: ["Fintech", "B2B SaaS"],
          verifiedOutcomes: null,
        },
        {
          name: "Studio North — agency site migration (sample)",
          url: "https://studionorth.example",
          description: "Webflow to Framer migration for a 12-person design studio.",
          services: ["Framer migrations"],
          industries: ["Design agency"],
          verifiedOutcomes: null,
        },
      ]);

      const pillarNames = [
        ["Landing page teardowns", "Breaking down real landing pages and what they communicate."],
        ["Website conversion principles", "Clarity, hierarchy, proof and CTAs."],
        ["Framer development tips", "Practical Framer techniques."],
        ["Design process & behind-the-scenes", "How projects actually get made."],
        ["Project breakdowns & case studies", "Walkthroughs of shipped work."],
        ["Personal learning & opinions", "Lessons and takes."],
        ["Client problems & website solutions", "Common problems founders bring and how to solve them."],
      ] as const;
      const pillars = await tx
        .insert(s.contentPillars)
        .values(pillarNames.map(([name, description], i) => ({ name, description, sortOrder: i * 10 })))
        .returning();
      const P = Object.fromEntries(pillars.map((p) => [p.name, p.id]));

      // Pillar "strength" drives sample metrics so analytics have a visible (sample) pattern.
      const strength: Record<string, number> = {
        "Landing page teardowns": 1.6,
        "Website conversion principles": 1.2,
        "Framer development tips": 1.0,
        "Design process & behind-the-scenes": 0.7,
        "Project breakdowns & case studies": 1.3,
        "Personal learning & opinions": 0.6,
        "Client problems & website solutions": 1.1,
      };

      const posts: { title: string; pillar: string; topic: string; hook: s.HookStyle; body: string; format: s.ContentFormat; cta: s.CtaType }[] = [
        { title: "Teardown: pricing page that hides the plan difference", pillar: "Landing page teardowns", topic: "pricing pages", hook: "observation", format: "carousel", cta: "comment", body: "Most SaaS pricing pages make you do the comparison work.\n\nI looked at a pricing page this week with three plans and 40 feature rows. The one difference that matters — seats — was row 31.\n\nThe fix is simple: lead each plan with who it is for and the one limit that changes.\n\nVisitors decide faster when the page decides what matters first." },
        { title: "Hero sections that describe features, not outcomes", pillar: "Website conversion principles", topic: "hero messaging", hook: "contrarian", format: "text", cta: "none", body: "Your hero section is not a feature list.\n\n“AI-powered workflows with real-time sync” tells me what it is.\nIt doesn't tell me what changes for me.\n\nTry writing the headline as the result your customer gets on a good week. Then let the subhead explain how." },
        { title: "Framer: responsive variants without duplicating pages", pillar: "Framer development tips", topic: "framer breakpoints", hook: "how_to", format: "thread", cta: "follow", body: "3 Framer habits that keep responsive builds clean:\n\n1. Build the desktop layout with stacks, not absolute positioning.\n2. Use component variants for breakpoint changes instead of hiding layers.\n3. Set max-widths on text, not on sections.\n\nYour tablet breakpoint will mostly take care of itself." },
        { title: "Why I start every project with the copy", pillar: "Design process & behind-the-scenes", topic: "design process", hook: "story", format: "text", cta: "none", body: "I used to open Figma first.\n\nNow every project starts with a doc: who the page is for, what they believe before landing, and the one action we want.\n\nThe design gets faster because most decisions are already made." },
        { title: "Case study: SaaS homepage rebuilt in Framer", pillar: "Project breakdowns & case studies", topic: "homepage redesign", hook: "story", format: "carousel", cta: "dm", body: "A walkthrough of a recent homepage rebuild (sample project).\n\nThe brief: the team shipped weekly, but the site took two weeks to update.\n\nWhat we changed:\n— Rewrote the hero around the outcome\n— Moved proof above the fold\n— Rebuilt in Framer so marketing can ship changes the same day" },
        { title: "Agencies: when to hand off Framer builds", pillar: "Client problems & website solutions", topic: "agency partnerships", hook: "question", format: "text", cta: "dm", body: "Agency owners: how many design hours do you lose to build work?\n\nA pattern I see: the studio designs a great site in Figma, then the build stretches for weeks because nobody on the team owns Framer.\n\nA dedicated build partner keeps your designers designing." },
        { title: "Social proof placement", pillar: "Website conversion principles", topic: "social proof", hook: "list", format: "text", cta: "none", body: "Where to put social proof on a SaaS landing page:\n\n1. Logos directly under the hero\n2. One specific testimonial next to the main CTA\n3. A short case study before pricing\n\nProof works best right before the moment of doubt." },
        { title: "What I learned from 50 landing page reviews", pillar: "Personal learning & opinions", topic: "lessons", hook: "data", format: "text", cta: "follow", body: "I've reviewed a lot of landing pages this year.\n\nThe most common issue isn't design. It's that the page tries to speak to everyone.\n\nPick the one reader you most want. Write for them. The page gets clearer immediately." },
        { title: "Teardown: onboarding tool homepage", pillar: "Landing page teardowns", topic: "homepage clarity", hook: "observation", format: "image", cta: "comment", body: "Quick teardown of an onboarding tool's homepage.\n\nGood: clear product screenshot above the fold.\nMissing: who it's for. The headline works for any SaaS.\n\nOne line — “for product teams onboarding 1,000+ users a month” — would do a lot of work." },
        { title: "Figma to Framer: what breaks", pillar: "Framer development tips", topic: "figma to framer", hook: "list", format: "thread", cta: "follow", body: "What usually breaks when moving from Figma to Framer:\n\n— Fixed heights on text containers\n— Effects stacked on groups instead of components\n— Spacing that depends on absolute positions\n\nFix those in Figma first and the build takes half the time." },
        { title: "Your CTA is asking for too much", pillar: "Website conversion principles", topic: "cta", hook: "contrarian", format: "text", cta: "none", body: "“Book a demo” is a big ask for a first visit.\n\nIf most visitors aren't ready, give them a smaller step: see the product, read a 2-minute case study, or try a template.\n\nKeep the demo CTA. Just don't make it the only door." },
        { title: "The migration checklist I send clients", pillar: "Client problems & website solutions", topic: "migrations", hook: "how_to", format: "link", cta: "link", body: "Moving a site to Framer? Before anything else:\n\n1. Export every URL and set up redirects\n2. Keep page titles and meta descriptions\n3. Rebuild forms and test integrations\n4. Check analytics events fire on the new site\n\nMost migration problems are SEO and tracking problems." },
      ];

      const versions: { id: string; platform: s.Platform; pillar: string; publishedAt: Date }[] = [];
      // ~44 published posts over the last ~120 days, alternating platforms.
      for (let i = 0; i < 44; i++) {
        const tpl = posts[i % posts.length]!;
        const age = Math.round(3 + i * 2.7 + rand() * 2);
        const platform: s.Platform = i % 3 === 0 ? "x" : "linkedin";
        const [item] = await tx
          .insert(s.contentItems)
          .values({
            title: i < posts.length ? tpl.title : `${tpl.title} (v${Math.floor(i / posts.length) + 1})`,
            pillarId: P[tpl.pillar],
            topic: tpl.topic,
            keywords: tpl.topic.split(" "),
            goal: pick(["authority", "engagement", "leads", "reach"] as const),
            audience: "B2B SaaS founders",
          })
          .returning();
        const publishedAt = daysAgo(age, pick([8, 9, 12, 17]));
        const [v] = await tx
          .insert(s.contentPlatformVersions)
          .values({
            contentItemId: item!.id,
            platform,
            format: platform === "x" && tpl.format === "carousel" ? "thread" : tpl.format,
            body: tpl.body,
            hookStyle: tpl.hook,
            ctaType: tpl.cta,
            status: "published",
            publishedAt,
            publishSource: "manual",
            platformPostUrl: platform === "x" ? `https://x.com/demo/status/${1800000000000 + i}` : `https://www.linkedin.com/feed/update/urn:li:activity:${7200000000000 + i}`,
          })
          .returning();
        versions.push({ id: v!.id, platform, pillar: tpl.pillar, publishedAt });
      }

      // Metric snapshots: one at +1 day, one at +7 days (if old enough). Some LinkedIn posts lack link clicks.
      for (const v of versions) {
        const k = strength[v.pillar]! * (0.7 + rand() * 0.6);
        const base = v.platform === "linkedin" ? 2400 : 3800;
        for (const offset of [1, 7]) {
          const at = new Date(v.publishedAt.getTime() + offset * DAY);
          if (at.getTime() > now) continue;
          const f = offset === 1 ? 0.65 : 1;
          const impressions = Math.round(base * k * f * (0.6 + rand()));
          const rate = (v.platform === "linkedin" ? 0.032 : 0.018) * k;
          const eng = Math.round(impressions * rate);
          await tx.insert(s.contentMetricsSnapshots).values({
            versionId: v.id,
            capturedAt: at,
            impressions,
            likes: Math.round(eng * 0.72),
            replies: Math.round(eng * 0.14),
            reposts: Math.round(eng * 0.1),
            bookmarks: v.platform === "x" ? Math.round(eng * 0.08) : null,
            linkClicks: rand() > 0.3 ? Math.round(impressions * 0.004 * k) : null,
            profileVisits: Math.round(impressions * 0.006 * k),
            meaningfulReplies: Math.round(eng * 0.05 * k),
            source: "manual",
          });
        }
      }

      // Audience snapshots weekly for 20 weeks.
      for (let w = 20; w >= 0; w--) {
        await tx.insert(s.audienceSnapshots).values([
          { platform: "linkedin", capturedAt: daysAgo(w * 7, 7), followers: 3100 + (20 - w) * between(28, 45), source: "manual" },
          { platform: "x", capturedAt: daysAgo(w * 7, 7), followers: 1850 + (20 - w) * between(12, 25), source: "manual" },
        ]);
      }

      // Upcoming / unpublished content.
      const upcoming: [string, string, s.Platform, s.ContentStatus, number | null, string][] = [
        ["Teardown: AI writing tool homepage", "Landing page teardowns", "linkedin", "scheduled", 1, "The headline promises “10x content”. The page never shows a single example…"],
        ["Teardown thread: AI writing tool homepage", "Landing page teardowns", "x", "scheduled", 2, "1/ Looked at an AI writing tool's homepage today."],
        ["Framer CMS for changelogs", "Framer development tips", "linkedin", "ready", 4, "Your changelog can live in Framer CMS."],
        ["What founders ask before a redesign", "Client problems & website solutions", "linkedin", "draft", 6, ""],
        ["Above-the-fold checklist", "Website conversion principles", "x", "draft", null, "5 things to check above the fold:"],
        ["Behind the scenes: client kickoff doc", "Design process & behind-the-scenes", "linkedin", "idea", null, ""],
      ];
      for (const [title, pillar, platform, status, inDays, body] of upcoming) {
        const [item] = await tx.insert(s.contentItems).values({ title, pillarId: P[pillar], goal: "authority" }).returning();
        await tx.insert(s.contentPlatformVersions).values({
          contentItemId: item!.id,
          platform,
          status,
          body,
          format: "text",
          plannedAt: inDays === null ? null : new Date(Math.floor((now + inDays * DAY) / DAY) * DAY + 9 * 3600000),
        });
      }
      await tx.insert(s.contentIdeas).values([
        { title: "Teardown series: 5 Series A SaaS homepages", pillarId: P["Landing page teardowns"], source: "manual" },
        { title: "How I price Framer migrations", pillarId: P["Client problems & website solutions"], source: "manual" },
      ]);

      // ---------------------------------------------------------------- Outreach
      const campaigns = await tx
        .insert(s.outreachCampaigns)
        .values([
          {
            name: "SaaS landing page outreach",
            description: "Early-stage B2B SaaS teams whose homepage leads with features rather than outcomes.",
            targetAudience: "Seed–Series A B2B SaaS founders",
            criteria: "Homepage hero is feature-led; team has shipped recently; 5–50 employees.",
            channel: "email",
            messageStrategy: "One specific, verified observation about the homepage. Offer to share 2 ideas. No attachments.",
            status: "active",
            startDate: new Date(now - 45 * DAY).toISOString().slice(0, 10),
          },
          {
            name: "Framer agency partnerships",
            description: "Design studios that design in Figma but don't have in-house Framer developers.",
            targetAudience: "Agency owners and creative directors",
            criteria: "Studio publishes web design work; no visible Framer builds.",
            channel: "linkedin",
            messageStrategy: "Relationship-first. Reference a specific project of theirs. Offer overflow build capacity.",
            status: "active",
            startDate: new Date(now - 30 * DAY).toISOString().slice(0, 10),
          },
          {
            name: "Founder website improvement",
            description: "Founders who post about their launch on X.",
            targetAudience: "Indie and early-stage founders on X",
            criteria: "Recent launch post, landing page live.",
            channel: "x",
            messageStrategy: "Public reply first, DM only if they engage.",
            status: "paused",
          },
        ])
        .returning();
      const [saas, agency, founders] = campaigns as [s.OutreachCampaign, s.OutreachCampaign, s.OutreachCampaign];

      const first = ["Maya", "Jonas", "Priya", "Tomás", "Lena", "Arjun", "Sofia", "Kenji", "Amara", "Noah", "Elif", "Daniel", "Ines", "Marco", "Hana", "Leo", "Zara", "Felix", "Nadia", "Oscar", "Rhea", "Sam", "Yara", "Theo", "Mila", "Ravi", "Clara", "Ivo"];
      const last = ["Brennan", "Okafor", "Lindqvist", "Varga", "Moreau", "Kapoor", "Rossi", "Tanaka", "Haddad", "Fischer", "Nkemelu", "Silva", "Dahl", "Costa"];
      const companyWords = ["Ledger", "Pilot", "Signal", "Harbor", "Quill", "Atlas", "Northwind", "Brightpath", "Cobalt", "Fieldnote", "Lumen", "Relay", "Tandem", "Orbit"];
      const suffix = ["HQ", "Labs", "Studio", "Analytics", "Cloud", "Works", "AI"];
      const types = [
        { companyType: "B2B SaaS", persona: "Founder", title: "Co-founder & CEO", campaign: saas, channel: "email" as const },
        { companyType: "B2B SaaS", persona: "Marketing lead", title: "Head of Marketing", campaign: saas, channel: "email" as const },
        { companyType: "Design agency", persona: "Agency owner", title: "Founder & Creative Director", campaign: agency, channel: "linkedin" as const },
        { companyType: "Startup", persona: "Founder", title: "Founder", campaign: founders, channel: "x" as const },
      ];
      const statusPlan = ["new", "new", "researched", "qualified", "ready", "ready", "contacted", "contacted", "contacted", "replied", "interested", "call_booked", "proposal_sent", "won", "lost", "not_a_fit"];

      const prospectRows: (s.Prospect & { channel: s.Channel; campaignId: string })[] = [];
      for (let i = 0; i < 28; i++) {
        const t = types[i % types.length]!;
        const company = `${companyWords[i % companyWords.length]} ${pick(suffix)}`;
        const slug = company.toLowerCase().replace(/[^a-z]+/g, "");
        const name = `${first[i]} ${last[i % last.length]}`;
        const status = statusPlan[i % statusPlan.length]!;
        const fit = between(45, 95);
        const [p] = await tx
          .insert(s.prospects)
          .values({
            fullName: name,
            jobTitle: t.title,
            company,
            companyWebsite: `https://${slug}.example`,
            websiteUrl: `https://${slug}.example`,
            linkedinUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, "-")}-demo`,
            xUrl: t.channel === "x" ? `https://x.com/${name.split(" ")[0]!.toLowerCase()}_demo` : null,
            email: t.channel === "email" ? `${name.split(" ")[0]!.toLowerCase()}@${slug}.example` : null,
            location: pick(["Berlin", "London", "Amsterdam", "Austin", "Toronto", "Lisbon", "Remote"]),
            companyType: t.companyType,
            industry: t.companyType === "Design agency" ? "Design services" : pick(["Fintech", "Developer tools", "HR tech", "Analytics", "Productivity"]),
            companySize: pick(["2–10", "11–50", "51–200"]),
            source: pick(["Manual research", "Referral", "LinkedIn post engagement", "CSV import"]),
            persona: t.persona,
            relevantServices: t.companyType === "Design agency" ? ["Agency Framer development partnerships"] : ["Conversion-focused landing pages", "Framer website design & development"],
            fitScore: fit,
            fitExplanation: fit > 75 ? "Matches target segment; homepage has a clear, specific improvement opportunity." : "Partially matches target segment; needs more research.",
            priority: fit > 80 ? "high" : fit > 60 ? "medium" : "low",
            status,
            preferredChannel: t.channel,
            tags: [t.companyType === "Design agency" ? "agency" : "saas", ...(fit > 80 ? ["high-fit"] : [])],
          })
          .returning();
        prospectRows.push({ ...p!, channel: t.channel, campaignId: t.campaign.id });
        await tx.insert(s.prospectSources).values({ prospectId: p!.id, sourceType: "manual", reason: "Sample record", reviewStatus: "added" });
      }

      const sentType: Record<s.Channel, s.EventType> = { email: "email_sent", linkedin: "linkedin_sent", x: "x_dm_sent" };
      const recvType: Record<s.Channel, s.EventType> = { email: "email_received", linkedin: "linkedin_received", x: "x_reply_received" };
      const contactedStatuses = new Set(["contacted", "replied", "interested", "call_booked", "proposal_sent", "won", "lost"]);
      for (const p of prospectRows) {
        if (!contactedStatuses.has(p.status)) continue;
        await tx.insert(s.campaignProspects).values({ campaignId: p.campaignId, prospectId: p.id, state: p.status === "contacted" ? "contacted" : "replied" }).onConflictDoNothing();
        const sentAt = daysAgo(between(4, 50), 10);
        const body = `Hi ${p.fullName.split(" ")[0]}, noticed ${p.company} helps teams with ${p.industry?.toLowerCase()}. I was looking at the homepage and wondered if making the main outcome more explicit above the fold could help visitors get the value faster. I work on conversion-focused landing pages and Framer builds. Happy to share a couple of ideas if useful.`;
        const [msg] = await tx
          .insert(s.outreachMessages)
          .values({
            prospectId: p.id,
            campaignId: p.campaignId,
            channel: p.channel,
            kind: "initial",
            variant: "short",
            subject: p.channel === "email" ? `${p.company} homepage — two ideas` : null,
            body,
            status: "sent",
            sendMethod: "manual",
            approvedAt: sentAt,
            sentAt,
          })
          .returning();
        await tx.insert(s.conversationEvents).values({
          prospectId: p.id,
          type: sentType[p.channel],
          channel: p.channel,
          direction: "outbound",
          occurredAt: sentAt,
          content: body,
          deliveryStatus: "sent",
          campaignId: p.campaignId,
          messageId: msg!.id,
          source: "manual",
        });
        let lastContacted = sentAt;
        if (p.status === "contacted") {
          await tx.insert(s.followUps).values({
            prospectId: p.id,
            dueAt: new Date(sentAt.getTime() + between(5, 9) * DAY),
            reason: "No reply to first message",
          });
        } else {
          const replyAt = new Date(sentAt.getTime() + between(1, 4) * DAY);
          const sentiment: s.Sentiment = p.status === "lost" ? "negative" : p.status === "replied" ? "neutral" : "positive";
          await tx.insert(s.conversationEvents).values({
            prospectId: p.id,
            type: recvType[p.channel],
            channel: p.channel,
            direction: "inbound",
            occurredAt: replyAt,
            content: sentiment === "positive" ? "Thanks — this is timely. Would love to hear the ideas." : sentiment === "neutral" ? "Thanks. Not a priority this quarter, maybe later." : "Appreciate it, but we're handling the site in-house.",
            sentiment,
            campaignId: p.campaignId,
            source: "manual",
          });
          lastContacted = replyAt;
          if (["call_booked", "proposal_sent", "won"].includes(p.status))
            await tx.insert(s.conversationEvents).values({ prospectId: p.id, type: "call_booked", direction: "internal", occurredAt: new Date(replyAt.getTime() + 2 * DAY), source: "manual", notes: "Intro call" });
          if (p.status === "interested")
            await tx.insert(s.followUps).values({ prospectId: p.id, dueAt: daysAgo(-2), reason: "Send the two homepage ideas" });
        }
        await tx.update(s.prospects).set({ lastContactedAt: sentAt, lastInteractionAt: lastContacted }).where(sql`id = ${p.id}`);
      }
      // One overdue follow-up and one due today for the follow-up manager.
      const contacted = prospectRows.filter((p) => p.status === "contacted");
      if (contacted[0]) await tx.insert(s.followUps).values({ prospectId: contacted[0].id, dueAt: daysAgo(3), reason: "Second follow-up" });
      if (contacted[1]) await tx.insert(s.followUps).values({ prospectId: contacted[1].id, dueAt: daysAgo(0, 15), reason: "Check if they saw the message" });
      await tx.execute(sql`update prospects set next_follow_up_at = (select min(due_at) from follow_ups f where f.prospect_id = prospects.id and f.status = 'pending')`);

      // Draft awaiting review.
      const ready = prospectRows.find((p) => p.status === "ready");
      if (ready)
        await tx.insert(s.outreachMessages).values({
          prospectId: ready.id,
          campaignId: ready.campaignId,
          channel: ready.channel,
          variant: "value_first",
          body: `Hi ${ready.fullName.split(" ")[0]}, I'm a Framer developer who works with teams like ${ready.company}. [Draft — add a verified observation before approving.]`,
          status: "draft",
        });

      // Opportunities.
      const oppFor = prospectRows.filter((p) => ["interested", "call_booked", "proposal_sent", "won", "lost"].includes(p.status));
      const stageFor: Record<string, string> = { interested: "engaged", call_booked: "discovery_call", proposal_sent: "proposal", won: "won", lost: "lost" };
      for (const p of oppFor) {
        const kind = stageFor[p.status]!;
        const createdAt = daysAgo(between(5, 30));
        await tx.insert(s.opportunities).values({
          prospectId: p.id,
          name: `${p.company} — ${p.companyType === "Design agency" ? "Framer build partnership" : "Homepage redesign"}`,
          company: p.company,
          serviceType: p.companyType === "Design agency" ? "Agency Framer development" : "Landing page design + Framer build",
          valueCents: between(30, 120) * 10000,
          currency: "USD",
          stage: kind,
          sourceChannel: "outreach",
          outreachCampaignId: p.campaignId,
          expectedCloseDate: new Date(now + between(7, 40) * DAY).toISOString().slice(0, 10),
          nextAction: kind === "won" || kind === "lost" ? null : pick(["Send proposal", "Schedule discovery call", "Share homepage ideas"]),
          closedAt: kind === "won" || kind === "lost" ? daysAgo(between(1, 4)) : null,
          lastActivityAt: daysAgo(between(0, 12)),
          createdAt,
        });
      }
      // An inbound opportunity attributed to content.
      const teardown = versions.find((v) => v.pillar === "Landing page teardowns");
      const [inboundOpp] = await tx
        .insert(s.opportunities)
        .values({
          name: "Inbound — Fieldnote Cloud pricing page",
          company: "Fieldnote Cloud (sample)",
          serviceType: "Pricing page redesign",
          valueCents: 450000,
          stage: "proposal",
          sourceChannel: "content",
          nextAction: "Follow up on proposal",
          lastActivityAt: daysAgo(2),
          createdAt: daysAgo(9),
        })
        .returning();
      if (teardown) {
        const [cv] = await tx.execute<{ content_item_id: string }>(sql`select content_item_id from content_platform_versions where id = ${teardown.id}`);
        await tx.update(s.opportunities).set({ contentItemId: cv!.content_item_id }).where(sql`id = ${inboundOpp!.id}`);
        await tx.insert(s.opportunityTouchpoints).values({ opportunityId: inboundOpp!.id, kind: "content", contentItemId: cv!.content_item_id, note: "Prospect mentioned the teardown post in their first message" });
      }

      // Research example for one prospect.
      const researched = prospectRows.find((p) => p.status === "ready") ?? prospectRows[0]!;
      await tx.insert(s.prospectResearch).values({
        prospectId: researched.id,
        url: researched.websiteUrl,
        whatTheyDo: `${researched.company} sells ${researched.industry?.toLowerCase()} software to small teams (sample).`,
        targetAudience: "Operations leads at 10–50 person companies",
        valueProposition: "All-in-one workspace for recurring reporting",
        primaryCta: "Book a demo",
        keySections: ["Hero", "Logo bar", "Feature grid", "Pricing teaser", "FAQ"],
        trustSignals: ["Customer logos", "SOC 2 badge"],
        observations: [
          { text: "Hero headline lists three features; no outcome is stated above the fold.", kind: "verified", source_url: researched.websiteUrl },
          { text: "The only CTA is “Book a demo”; there is no lower-commitment option.", kind: "verified", source_url: researched.websiteUrl },
          { text: "First-time visitors may not understand who the product is for.", kind: "hypothesis", source_url: null },
        ],
        sources: [researched.websiteUrl!],
        generatedBy: "manual",
        reviewStatus: "reviewed",
        fetchedAt: daysAgo(2),
      });
      await tx.insert(s.suppressionList).values({ domain: "optedout.example", reason: "opt_out" });
      await tx.insert(s.activityLogs).values({ action: "demo.seeded", metadata: { note: "Sample data" } });
    });
    console.log("Demo workspace seeded.");
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("seed-demo.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  seedDemo(url, { reset: process.argv.includes("--reset") }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
