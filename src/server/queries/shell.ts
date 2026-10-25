import "server-only";
import { and, asc, count, eq, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { endOfDay } from "date-fns";
import type { Tx } from "@/db/client";
import {
  contentItems,
  contentPillars,
  followUps,
  integrations,
  leadStatuses,
  opportunities,
  outreachCampaigns,
  outreachMessages,
  profiles,
  prospects,
} from "@/db/schema";

export type Notification = { id: string; title: string; detail: string; href: string; tone: "warning" | "danger" | "info" };

export async function getShellData(tx: Tx, userId: string) {
  const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId));
  const [due] = await tx
    .select({ n: count() })
    .from(followUps)
    .where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, endOfDay(new Date()))));
  const [failed] = await tx
    .select({ n: count() })
    .from(outreachMessages)
    .where(or(eq(outreachMessages.status, "failed"), eq(outreachMessages.status, "bounced")));
  const [awaitingApproval] = await tx.select({ n: count() }).from(outreachMessages).where(eq(outreachMessages.status, "draft"));
  const brokenIntegrations = await tx
    .select({ provider: integrations.provider, lastError: integrations.lastError })
    .from(integrations)
    .where(or(eq(integrations.status, "error"), eq(integrations.status, "expired")));
  const pillars = await tx
    .select({ id: contentPillars.id, name: contentPillars.name })
    .from(contentPillars)
    .where(isNull(contentPillars.archivedAt))
    .orderBy(asc(contentPillars.sortOrder), asc(contentPillars.name));
  const statuses = await tx
    .select({ key: leadStatuses.key, label: leadStatuses.label, category: leadStatuses.category })
    .from(leadStatuses)
    .orderBy(asc(leadStatuses.sortOrder));
  const campaigns = await tx
    .select({ id: outreachCampaigns.id, name: outreachCampaigns.name })
    .from(outreachCampaigns)
    .orderBy(asc(outreachCampaigns.name));

  const notifications: Notification[] = [];
  if (due!.n > 0)
    notifications.push({
      id: "followups",
      title: `${due!.n} follow-up${due!.n === 1 ? "" : "s"} due`,
      detail: "Due today or overdue",
      href: "/follow-ups",
      tone: "warning",
    });
  if (failed!.n > 0)
    notifications.push({
      id: "failed",
      title: `${failed!.n} message${failed!.n === 1 ? "" : "s"} failed`,
      detail: "Review the error before retrying",
      href: "/inbox?view=failed",
      tone: "danger",
    });
  if (awaitingApproval!.n > 0)
    notifications.push({
      id: "drafts",
      title: `${awaitingApproval!.n} draft${awaitingApproval!.n === 1 ? "" : "s"} awaiting review`,
      detail: "Approve, edit, or discard",
      href: "/inbox?view=drafts",
      tone: "info",
    });
  for (const i of brokenIntegrations)
    notifications.push({
      id: `int-${i.provider}`,
      title: `${i.provider.toUpperCase()} integration needs attention`,
      detail: i.lastError ?? "Reconnect to resume syncing",
      href: "/integrations",
      tone: "danger",
    });

  return { profile: profile ?? null, notifications, pillars, statuses, campaigns, followUpsDue: due!.n };
}

export type ShellData = Awaited<ReturnType<typeof getShellData>>;

export async function searchEverything(tx: Tx, q: string) {
  const term = `%${q.replace(/[%_]/g, "")}%`;
  const [p, c, camp, o] = await Promise.all([
    tx
      .select({ id: prospects.id, name: prospects.fullName, company: prospects.company })
      .from(prospects)
      .where(or(ilike(prospects.fullName, term), ilike(prospects.company, term), ilike(prospects.email, term)))
      .limit(6),
    tx
      .select({ id: contentItems.id, title: contentItems.title })
      .from(contentItems)
      .where(
        or(
          ilike(contentItems.title, term),
          ilike(contentItems.topic, term),
          sql`exists (select 1 from content_platform_versions v where v.content_item_id = ${contentItems.id} and v.body ilike ${term})`,
        ),
      )
      .limit(6),
    tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).where(ilike(outreachCampaigns.name, term)).limit(4),
    tx
      .select({ id: opportunities.id, name: opportunities.name, company: opportunities.company })
      .from(opportunities)
      .where(or(ilike(opportunities.name, term), ilike(opportunities.company, term)))
      .limit(4),
  ]);
  return { prospects: p, content: c, campaigns: camp, opportunities: o };
}
