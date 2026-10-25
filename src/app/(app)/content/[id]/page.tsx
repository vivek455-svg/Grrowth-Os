import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/content/content-editor";
import { loadForUser } from "@/server/page";
import { contentDetail } from "@/server/queries/content";
import { aiStatus } from "@/server/ai";

export const metadata = { title: "Post" };

export default async function ContentItemPage({ params }: PageProps<"/content/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadForUser((tx) => contentDetail(tx, id));
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
    />
  );
}
