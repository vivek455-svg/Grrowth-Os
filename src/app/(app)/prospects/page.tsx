import Link from "next/link";
import { count } from "drizzle-orm";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { AddProspectButton } from "@/components/prospects/add-prospect-button";
import { ProspectTable, type ProspectRow } from "@/components/prospects/prospect-table";
import { loadForUser } from "@/server/page";
import { BUILTIN_VIEWS, campaignsForProspects, listProspects, prospectFilterOptions, type ProspectFilters } from "@/server/queries/prospects";
import { prospects } from "@/db/schema";

export const metadata = { title: "Prospects" };

const KEYS: (keyof ProspectFilters)[] = ["q", "status", "priority", "channel", "companyType", "persona", "tag", "fitMin", "campaign", "uncontacted", "due", "positive", "hasOpp", "sort"];

export default async function ProspectsPage({ searchParams }: PageProps<"/prospects">) {
  const sp = await searchParams;
  const filters: ProspectFilters = {};
  for (const k of KEYS) if (typeof sp[k] === "string" && sp[k]) filters[k] = sp[k] as string;
  // Recommendation deep link
  if (sp.view === "high-fit-uncontacted") Object.assign(filters, BUILTIN_VIEWS.find((v) => v.key === "high-fit-uncontacted")!.filters);

  const { rows, options, total, camps } = await loadForUser(async (tx) => {
    const rows = await listProspects(tx, filters);
    const [{ n }] = (await tx.select({ n: count() }).from(prospects)) as [{ n: number }];
    return { rows, options: await prospectFilterOptions(tx), total: n, camps: await campaignsForProspects(tx, rows.map((r) => r.id)) };
  });

  // Possible duplicates within the list: same website domain + same normalised name.
  const seen = new Map<string, string>();
  const tableRows: ProspectRow[] = rows.map((r) => {
    const key = r.domainKey ? `${r.domainKey}|${r.fullName.toLowerCase().replace(/\s+/g, " ").trim()}` : null;
    const dup = key ? (seen.get(key) ?? null) : null;
    if (key && !dup) seen.set(key, r.id);
    return { ...r, campaigns: camps.get(r.id) ?? [], duplicateOf: dup };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prospects"
        description="Everyone you might work with — researched, qualified, and tracked across email, LinkedIn and X."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/prospects" download>
                <Download /> Export
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/prospects/import">
                <Upload /> Import CSV
              </Link>
            </Button>
            <AddProspectButton />
          </>
        }
      />
      <ProspectTable rows={tableRows} total={total} options={{ ...options, views: options.views.map((v) => ({ id: v.id, name: v.name, filters: v.filters })), builtin: BUILTIN_VIEWS }} />
    </div>
  );
}
