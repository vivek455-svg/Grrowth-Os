"use server";

import { z } from "zod";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { startOfDay } from "date-fns";
import {
  campaignProspects,
  conversationEvents,
  conversations,
  followUps,
  outreachMessages,
  profiles,
  prospects,
  suppressionList,
  type OutreachMessage,
} from "@/db/schema";
import { UserError, audit, defineAction } from "@/server/action";
import type { Tx } from "@/db/client";
import { withUser } from "@/db/client";
import { requireUser } from "@/server/auth";
import { cooldownBlock, followUpBlock, nextStatusAfterEvent, suppressionReason } from "@/lib/domain/outreach-rules";
import { SENT_EVENT_FOR_CHANNEL } from "@/lib/labels";
import { gmailProvider } from "@/server/integrations/providers";
import { IntegrationError, markIntegrationError } from "@/server/integrations/oauth";
import { log } from "@/lib/logger";
import type { ActionResult } from "@/server/action";
import { revalidatePath } from "next/cache";

const uuid = z.string().uuid();

/** All safety checks that must pass before a message may go out (by API or manually). */
async function preflight(tx: Tx, userId: string, m: OutreachMessage) {
  const [p] = await tx.select().from(prospects).where(eq(prospects.id, m.prospectId));
  if (!p) throw new UserError("Prospect not found.");
  const suppression = suppressionReason(p, await tx.select().from(suppressionList));
  if (suppression) throw new UserError(`Blocked: ${suppression}.`);
  const events = await tx
    .select({ direction: conversationEvents.direction, occurredAt: conversationEvents.occurredAt })
    .from(conversationEvents)
    .where(and(eq(conversationEvents.prospectId, p.id), inArray(conversationEvents.direction, ["inbound", "outbound"])))
    .orderBy(desc(conversationEvents.occurredAt));
  const lastOut = events.find((e) => e.direction === "outbound")?.occurredAt ?? null;
  const lastIn = events.find((e) => e.direction === "inbound")?.occurredAt ?? null;
  if (m.kind === "follow_up") {
    const block = followUpBlock({ lastOutboundAt: lastOut, lastInboundAt: lastIn, suppression: null });
    if (block) throw new UserError(block);
  }
  if (m.kind === "initial" || m.kind === "connection_request") {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId));
    const cd = cooldownBlock(p.lastContactedAt, profile?.outreachCooldownDays ?? 30);
    if (cd) throw new UserError(`Duplicate-contact protection: ${cd} Use a follow-up instead, or change the cooldown in Settings.`);
  }
  if (m.channel === "email" && !p.email) throw new UserError("This prospect has no email address.");
  if (m.channel === "email" && !m.subject?.trim()) throw new UserError("Add a subject line before sending an email.");
  return p;
}

export const approveMessage = defineAction("message.approve", z.object({ id: uuid }), async ({ id }, { tx, user }) => {
  const [m] = await tx.select().from(outreachMessages).where(eq(outreachMessages.id, id));
  if (!m) throw new UserError("Message not found.");
  if (m.status !== "draft") throw new UserError("Only drafts can be approved.");
  await preflight(tx, user.id, m);
  await tx.update(outreachMessages).set({ status: "approved", approvedAt: new Date() }).where(eq(outreachMessages.id, id));
  await audit(tx, "message.approved", { type: "outreach_message", id }, { channel: m.channel });
  if (m.campaignId) await tx.update(campaignProspects).set({ state: "approved" }).where(and(eq(campaignProspects.campaignId, m.campaignId), eq(campaignProspects.prospectId, m.prospectId)));
  return null;
});

export const cancelMessage = defineAction("message.cancel", z.object({ id: uuid }), async ({ id }, { tx }) => {
  const res = await tx
    .update(outreachMessages)
    .set({ status: "cancelled" })
    .where(and(eq(outreachMessages.id, id), inArray(outreachMessages.status, ["draft", "approved", "failed"])))
    .returning({ id: outreachMessages.id });
  if (!res.length) throw new UserError("This message can't be cancelled.");
  return null;
});

async function recordSent(tx: Tx, m: OutreachMessage, at: Date, method: "api" | "manual", external?: { messageId: string; threadId: string | null }) {
  await tx
    .update(outreachMessages)
    .set({ status: "sent", sendMethod: method, sentAt: at, externalMessageId: external?.messageId ?? null, externalThreadId: external?.threadId ?? null, error: null })
    .where(eq(outreachMessages.id, m.id));
  let conversationId: string | null = null;
  if (external?.threadId) {
    const [c] = await tx
      .insert(conversations)
      .values({ prospectId: m.prospectId, channel: m.channel, externalThreadId: external.threadId, syncSource: "synced", subject: m.subject, lastEventAt: at })
      .onConflictDoUpdate({ target: [conversations.userId, conversations.channel, conversations.externalThreadId], targetWhere: sql`external_thread_id is not null`, set: { lastEventAt: at } })
      .returning({ id: conversations.id });
    conversationId = c!.id;
  }
  const type = m.kind === "connection_request" ? "connection_request_sent" : SENT_EVENT_FOR_CHANNEL[m.channel];
  await tx.insert(conversationEvents).values({
    prospectId: m.prospectId,
    conversationId,
    type,
    channel: m.channel,
    direction: "outbound",
    occurredAt: at,
    content: m.subject ? `${m.subject}\n\n${m.body}` : m.body,
    externalMessageId: external?.messageId ?? null,
    deliveryStatus: "sent",
    campaignId: m.campaignId,
    messageId: m.id,
    source: method === "api" ? "synced" : "manual",
  });
  const [p] = await tx.select().from(prospects).where(eq(prospects.id, m.prospectId));
  if (p) {
    await tx
      .update(prospects)
      .set({ lastContactedAt: at, lastInteractionAt: at, status: nextStatusAfterEvent(p.status, type, null) })
      .where(eq(prospects.id, p.id));
  }
  if (m.kind === "follow_up")
    await tx.update(followUps).set({ status: "done", completedAt: at, messageId: m.id }).where(and(eq(followUps.prospectId, m.prospectId), eq(followUps.status, "pending"), sql`${followUps.dueAt} <= ${new Date(at.getTime() + 86400000).toISOString()}::timestamptz`));
  if (m.campaignId) await tx.update(campaignProspects).set({ state: "contacted" }).where(and(eq(campaignProspects.campaignId, m.campaignId), eq(campaignProspects.prospectId, m.prospectId)));
  await audit(tx, method === "api" ? "message.sent_api" : "message.sent_manual", { type: "outreach_message", id: m.id }, { channel: m.channel });
}

/**
 * Copy-and-open workflow: the user sent the message themselves (LinkedIn, X, or their mail
 * client) and confirms it here. Stored as manually recorded — never as delivered.
 */
export const recordManualSend = defineAction(
  "message.record_manual_send",
  z.object({ id: uuid, sentAt: z.coerce.date().default(() => new Date()), followUpAt: z.coerce.date().nullable().optional() }),
  async ({ id, sentAt, followUpAt }, { tx, user }) => {
    const [m] = await tx.select().from(outreachMessages).where(eq(outreachMessages.id, id));
    if (!m) throw new UserError("Message not found.");
    if (m.status !== "approved") throw new UserError(m.status === "sent" ? "Already recorded as sent." : "Approve the message first.");
    if (sentAt > new Date(Date.now() + 5 * 60000)) throw new UserError("The send time can't be in the future.");
    await preflight(tx, user.id, m);
    await recordSent(tx, m, sentAt, "manual");
    if (followUpAt) {
      await tx.insert(followUps).values({ prospectId: m.prospectId, dueAt: followUpAt, reason: "Follow up if no reply", suggested: false });
      await tx.update(prospects).set({ nextFollowUpAt: followUpAt }).where(eq(prospects.id, m.prospectId));
    }
    return null;
  },
);

/**
 * Sends an approved email through Gmail. Idempotent: the status moves approved/failed → sending
 * atomically, so a double click or retry can never send twice. Only a successful API response
 * marks it as sent.
 */
export async function sendEmailViaGmail(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await requireUser();
  const id = parsed.data.id;

  // 1. Claim the message and run checks in one short transaction.
  let claimed: { m: OutreachMessage; to: string; fromName: string | null };
  try {
    claimed = await withUser(user.id, async (tx) => {
      const [m] = await tx.select().from(outreachMessages).where(eq(outreachMessages.id, id));
      if (!m) throw new UserError("Message not found.");
      if (m.channel !== "email") throw new UserError("Only email can be sent through Gmail.");
      if (m.status === "failed" && m.externalMessageId) throw new UserError("This message may already have been delivered. Check Gmail before retrying.");
      if (!["approved", "failed"].includes(m.status) || !m.approvedAt) throw new UserError("Approve the message before sending.");
      const p = await preflight(tx, user.id, m);
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
      const [sentToday] = await tx
        .select({ n: count() })
        .from(outreachMessages)
        .where(and(eq(outreachMessages.sendMethod, "api"), gte(outreachMessages.sentAt, startOfDay(new Date()))));
      if ((sentToday?.n ?? 0) >= (profile?.dailySendLimit ?? 25)) throw new UserError(`Daily send limit reached (${profile?.dailySendLimit}). Change it in Settings or send tomorrow.`);
      const res = await tx
        .update(outreachMessages)
        .set({ status: "sending", idempotencyKey: m.idempotencyKey ?? `gmail:${m.id}`, error: null })
        .where(and(eq(outreachMessages.id, id), inArray(outreachMessages.status, ["approved", "failed"])))
        .returning({ id: outreachMessages.id });
      if (!res.length) throw new UserError("This message is already being sent.");
      return { m, to: p.email!, fromName: profile?.fullName ?? null };
    });
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    log("error", "send_preflight_failed", { error: e });
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // 2. Call the provider outside any transaction.
  let result: { messageId: string; threadId: string | null };
  try {
    result = await gmailProvider.send(user.id, { to: claimed.to, subject: claimed.m.subject ?? "", body: claimed.m.body, fromName: claimed.fromName });
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : "Sending failed. Nothing was sent.";
    await withUser(user.id, async (tx) => {
      await tx.update(outreachMessages).set({ status: "failed", error: message }).where(eq(outreachMessages.id, id));
      await audit(tx, "message.send_failed", { type: "outreach_message", id }, { error: message });
    });
    if (e instanceof IntegrationError) await markIntegrationError(user.id, "gmail", e);
    else log("error", "gmail_send_failed", { error: e });
    revalidatePath("/", "layout");
    return { ok: false, error: message };
  }

  // 3. The provider confirmed the send. Record it; if recording fails, still persist the external
  //    id so the message can never be retried into a duplicate.
  try {
    await withUser(user.id, (tx) => recordSent(tx, { ...claimed.m, status: "sending" }, new Date(), "api", result));
  } catch (e) {
    log("error", "send_record_failed", { messageId: id, error: e });
    await withUser(user.id, (tx) =>
      tx.update(outreachMessages).set({ status: "sent", sendMethod: "api", sentAt: new Date(), externalMessageId: result.messageId, externalThreadId: result.threadId }).where(eq(outreachMessages.id, id)),
    );
  }
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
