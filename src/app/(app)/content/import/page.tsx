import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/components/imports/import-wizard";

export const metadata = { title: "Import content" };

export default function ImportContentPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Import past posts" description="Bring in your post history and metrics so analytics have something to work with." />
      <ImportWizard kind="content" />
    </div>
  );
}
