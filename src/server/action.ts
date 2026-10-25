import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser, type Tx } from "@/db/client";
import { activityLogs } from "@/db/schema";
import { log } from "@/lib/logger";
import { requireUser, type SessionUser } from "./auth";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

export type ActionCtx = { user: SessionUser; tx: Tx };

function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Wraps a server action with: authentication, Zod validation, an RLS-scoped transaction,
 * safe error messages, structured logging, and cache revalidation.
 */
export function defineAction<S extends z.ZodType, R>(
  name: string,
  schema: S,
  handler: (input: z.output<S>, ctx: ActionCtx) => Promise<R>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return { ok: false, error: flat.formErrors[0] ?? "Please check the highlighted fields.", fieldErrors: flat.fieldErrors as Record<string, string[] | undefined> };
    }
    const user = await requireUser();
    try {
      const data = await withUser(user.id, (tx) => handler(parsed.data, { user, tx }));
      revalidatePath("/", "layout");
      return { ok: true, data };
    } catch (e) {
      if (e instanceof UserError) return { ok: false, error: e.message };
      const code = pgCode(e);
      if (code === "23505") return { ok: false, error: "A record with the same unique details already exists." };
      if (code === "23514" || code === "23503") return { ok: false, error: "That change isn't valid for this record." };
      // Next.js uses thrown errors for redirect()/notFound(); let them propagate.
      if (e && typeof e === "object" && "digest" in e) throw e;
      log("error", "action_failed", { action: name, userId: user.id, error: e });
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}

/** Append-only audit trail for sensitive actions (sends, deletions, integration changes). */
export async function audit(
  tx: Tx,
  action: string,
  entity?: { type: string; id?: string | null },
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(activityLogs).values({ action, entityType: entity?.type, entityId: entity?.id ?? null, metadata });
}

/** Coerce empty strings from forms into null. */
export const optionalText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const optionalUrl = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "Enter a full URL starting with https://");

export const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Invalid date");
