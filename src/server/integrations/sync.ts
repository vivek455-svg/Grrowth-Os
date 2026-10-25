import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { asService, withUser } from "@/db/client";
import { audienceSnapshots, contentItems, contentMetricsSnapshots, contentPlatformVersions, integrations, syncJobs } from "@/db/schema";
import { log } from "@/lib/logger";
import { IntegrationError, markIntegrationError } from "./oauth";
import { xProvider } from "./providers";

/**
 * Pulls the user's recent X posts and metrics. Posts already in the library (matched by post id)
 * get a new metrics snapshot; unknown posts are imported as published content with source "api".
 * Each run is recorded in sync_jobs with its outcome. Transient failures are retried by the next run.
 */
export async function runXSync(userId: string, trigger: "manual" | "cron") {
  const [job] = await withUser(userId, (tx) =>
    tx.insert(syncJobs).values({ provider: "x", kind: "metrics", status: "running", startedAt: new Date(), attempts: 1, result: { trigger } }).returning(),
  );
  try {
    const { posts, followers } = await xProvider.recentPosts(userId, 100);
    const summary = await withUser(userId, async (tx) => {
      const ids = posts.map((p) => p.postId);
      const existing = ids.length
        ? await tx
            .select({ id: contentPlatformVersions.id, postId: contentPlatformVersions.platformPostId })
            .from(contentPlatformVersions)
            .where(and(eq(contentPlatformVersions.platform, "x"), inArray(contentPlatformVersions.platformPostId, ids)))
        : [];
      const byPost = new Map(existing.map((e) => [e.postId!, e.id]));
      let imported = 0;
      for (const p of posts) {
        let versionId = byPost.get(p.postId);
        if (!versionId) {
          const [item] = await tx.insert(contentItems).values({ title: p.text.split("\n")[0]!.slice(0, 80) || "Imported X post" }).returning({ id: contentItems.id });
          const [v] = await tx
            .insert(contentPlatformVersions)
            .values({
              contentItemId: item!.id,
              platform: "x",
              body: p.text,
              status: "published",
              publishedAt: p.createdAt,
              publishSource: "api",
              platformPostId: p.postId,
              platformPostUrl: `https://x.com/i/web/status/${p.postId}`,
            })
            .returning({ id: contentPlatformVersions.id });
          versionId = v!.id;
          imported++;
        }
        await tx.insert(contentMetricsSnapshots).values({
          versionId,
          impressions: p.impressions,
          likes: p.likes,
          replies: p.replies,
          reposts: p.reposts,
          bookmarks: p.bookmarks,
          linkClicks: p.linkClicks,
          profileVisits: p.profileVisits,
          source: "api",
        });
      }
      if (followers !== null) await tx.insert(audienceSnapshots).values({ platform: "x", followers, source: "api" });
      const result = { posts: posts.length, imported, updated: posts.length - imported, followers };
      await tx.update(syncJobs).set({ status: "succeeded", finishedAt: new Date(), result: { trigger, ...result } }).where(eq(syncJobs.id, job!.id));
      await tx.update(integrations).set({ lastSyncAt: new Date(), lastError: null, status: "connected" }).where(eq(integrations.provider, "x"));
      return result;
    });
    return summary;
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : "Sync failed unexpectedly.";
    log("warn", "x_sync_failed", { userId, error: e });
    await withUser(userId, (tx) => tx.update(syncJobs).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(syncJobs.id, job!.id)));
    await markIntegrationError(userId, "x", e);
    throw e instanceof IntegrationError ? e : new IntegrationError(message);
  }
}

/** Cron entry point: sync every connected X account. Users are processed independently. */
export async function runScheduledSyncs() {
  const rows = await asService((db) => db.select({ userId: integrations.userId }).from(integrations).where(and(eq(integrations.provider, "x"), eq(integrations.status, "connected"))));
  const results: { userId: string; ok: boolean }[] = [];
  for (const r of rows) {
    try {
      await runXSync(r.userId, "cron");
      results.push({ userId: r.userId, ok: true });
    } catch {
      results.push({ userId: r.userId, ok: false });
    }
  }
  return results;
}
