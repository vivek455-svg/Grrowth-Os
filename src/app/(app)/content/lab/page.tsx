import { asc, isNull } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ContentLab } from "@/components/content/content-lab";
import { loadForUser } from "@/server/page";
import { labSources } from "@/server/queries/content";
import { aiStatus } from "@/server/ai";
import { contentPillars, type ContentFormat } from "@/db/schema";

export const metadata = { title: "AI Content Lab" };

const FORMATS = ["text", "image", "carousel", "video", "link", "thread"];

export default async function LabPage({ searchParams }: PageProps<"/content/lab">) {
  const sp = await searchParams;
  const status = aiStatus();
  const { pillars, sources } = await loadForUser(async (tx) => ({
    pillars: await tx.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(isNull(contentPillars.archivedAt)).orderBy(asc(contentPillars.sortOrder)),
    sources: await labSources(tx),
  }));
  const format = typeof sp.format === "string" && FORMATS.includes(sp.format) ? (sp.format as ContentFormat) : null;
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Content Lab"
        description="Plan and draft posts in your voice. Edit, then save as drafts or add to the calendar."
        actions={status.connected ? <Badge variant="outline" className="font-normal">{status.model}</Badge> : <Badge variant="outline">AI not connected</Badge>}
      />
      <ContentLab aiEnabled={status.connected} pillars={pillars} sources={sources} initialFormat={format} />
    </div>
  );
}
