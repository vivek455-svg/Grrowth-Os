"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contentPlatformVersions } from "@/db/schema";
import { UserError, audit, defineAIAction, type ActionResult } from "@/server/action";
import { requireUser } from "@/server/auth";
import { withUser } from "@/db/client";
import { disconnect, IntegrationError, markIntegrationError } from "@/server/integrations/oauth";
import { publishingProvider } from "@/server/integrations/providers";
import { runXSync } from "@/server/integrations/sync";
import { log } from "@/lib/logger";

export const disconnectIntegration = defineAIAction(
  "integration.disconnect",
  z.object({ provider: z.enum(["x", "linkedin", "gmail"]) }),
  async ({ provider }, { user }) => {
    await disconnect(user.id, provider);
    revalidatePath("/integrations");
    return null;
  },
);

export const syncIntegration = defineAIAction("integration.sync", z.object({ provider: z.literal("x") }), async (_input, { user }) => {
  try {
    const r = await runXSync(user.id, "manual");
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    revalidatePath("/integrations");
    if (e instanceof IntegrationError) throw new UserError(e.message);
    throw e;
  }
});

/**
 * Publishes a post through the platform API after explicit confirmation in the UI.
 * The version is marked published only when the platform returns a post id.
 */
export async function publishViaAPI(input: { versionId: string; confirmed: boolean }): Promise<ActionResult<{ url: string | null }>> {
  const parsed = z.object({ versionId: z.string().uuid(), confirmed: z.literal(true) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Publishing needs explicit confirmation." };
  const user = await requireUser();
  const [v] = await withUser(user.id, (tx) => tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, parsed.data.versionId)));
  if (!v) return { ok: false, error: "Post not found." };
  if (v.status === "published") return { ok: false, error: "This post is already published." };
  if (!v.body.trim()) return { ok: false, error: "The post is empty." };
  if (v.format !== "text" && v.format !== "link") return { ok: false, error: "Only text and link posts can be published via the API. Publish media posts manually." };
  try {
    const res = await publishingProvider(v.platform).publish(user.id, v.body);
    await withUser(user.id, async (tx) => {
      await tx
        .update(contentPlatformVersions)
        .set({ status: "published", publishedAt: new Date(), publishSource: "api", platformPostId: res.postId, platformPostUrl: res.url })
        .where(eq(contentPlatformVersions.id, v.id));
      await audit(tx, "content.published_api", { type: "content_version", id: v.id }, { platform: v.platform, postId: res.postId });
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { url: res.url } };
  } catch (e) {
    if (e instanceof IntegrationError) {
      await markIntegrationError(user.id, v.platform, e);
      return { ok: false, error: `Not published: ${e.message}` };
    }
    log("error", "publish_failed", { error: e });
    return { ok: false, error: "Not published: unexpected error. Check the platform before retrying." };
  }
}
