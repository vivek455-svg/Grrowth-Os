import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/components/imports/import-wizard";
import { loadForUser } from "@/server/page";
import { leadStatuses } from "@/db/schema";

export const metadata = { title: "Import prospects" };

export default async function ImportProspectsPage() {
  const statuses = await loadForUser((tx) => tx.select({ key: leadStatuses.key, label: leadStatuses.label }).from(leadStatuses).orderBy(asc(leadStatuses.sortOrder)));
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Import prospects" description="Map columns, check duplicates and errors, then import only the rows you approve." />
      <ImportWizard kind="prospects" statuses={statuses} />
    </div>
  );
}
