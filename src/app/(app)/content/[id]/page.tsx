import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/content/content-editor";
import { loadForUser } from "@/server/page";
import { contentDetail } from "@/server/queries/content";
import { aiStatus } from "@/server/ai";
import { eq } from "drizzle-orm";
import { integrations } from "@/db/schema";

export const metadata = { title: "Post" };

export default async function ContentItemPage({ params }: PageProps<"/content/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadForUser(async (tx) => {
    const d = await contentDetail(tx, id);
    const conns = await tx.select({ provider: integrations.provider }).from(integrations).where(eq(integrations.status, "connected"));
    return d && { ...d, connected: { x: conns.some((c) => c.provider === "x"), linkedin: conns.some((c) => c.provider === "linkedin") } };
  });
  if (!data) notFound();
  return (
    <ContentEditor
      item={data.item}
      versions={data.versions}
      snapshots={data.snapshots}
      tags={data.tags}
      pillars={data.pillars}
      campaigns={data.campaigns}
      linkedOpps={data.linkedOpps}
      aiEnabled={aiStatus().connected}
      connected={data.connected}
    />
  );
}
