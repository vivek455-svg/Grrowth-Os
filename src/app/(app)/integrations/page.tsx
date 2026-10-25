import { desc } from "drizzle-orm";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { IntegrationCard, type IntegrationView } from "@/components/settings/integration-card";
import { loadForUser } from "@/server/page";
import { INTEGRATIONS } from "@/server/integrations/registry";
import { aiStatus } from "@/server/ai";
import { env } from "@/lib/env";
import { integrations, syncJobs } from "@/db/schema";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const sp = await searchParams;
  const { rows, jobs, isDemo } = await loadForUser(async (tx, user) => ({
    rows: await tx.select().from(integrations),
    jobs: await tx.select().from(syncJobs).orderBy(desc(syncJobs.createdAt)).limit(10),
    isDemo: user.isDemo,
  }));
  const ai = aiStatus();
  const views: IntegrationView[] = INTEGRATIONS.map((d) => {
    const row = rows.find((r) => r.provider === d.key);
    const configured = d.configured();
    const status: IntegrationView["status"] =
      d.kind === "env" ? (configured ? "connected" : "not_configured") : !configured && !row ? "not_configured" : (row?.status ?? "disconnected");
    return {
      key: d.key,
      name: d.name,
      description: d.description,
      kind: d.kind,
      scopes: d.scopes,
      capabilities: d.capabilities,
      limitations: d.limitations,
      fallback: d.fallback,
      envVars: d.envVars,
      configured,
      docsUrl: d.docsUrl,
      status,
      account: row?.externalAccountName ?? null,
      grantedScopes: row?.scopes ?? [],
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      detail: d.key === "ai" && ai.connected ? `${ai.provider} · ${ai.model}` : d.key === "search" && configured ? (env().SEARCH_PROVIDER ?? "brave") : null,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="Connect only what you need. Every feature has a manual fallback, and nothing is sent or published without your approval."
      />
      {sp.connected && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>{String(sp.connected).toUpperCase()} is connected.</AlertDescription>
        </Alert>
      )}
      {sp.error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{sp.error === "demo" ? "Integrations can't be connected in the demo workspace." : String(sp.error).slice(0, 300)}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {views.map((v) => (
          <IntegrationCard key={v.key} i={v} isDemo={isDemo} />
        ))}
      </div>
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Sync history</CardTitle>
          <CardDescription>Scheduled syncs run when CRON_SECRET is configured (see the README). Failed runs are retried on the next schedule.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Started</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="num pl-4 text-muted-foreground">{fmtDateTime(j.startedAt ?? j.createdAt)}</TableCell>
                  <TableCell>{j.provider.toUpperCase()} · {j.kind}</TableCell>
                  <TableCell><Badge variant={j.status === "failed" ? "destructive" : "outline"} className="font-normal">{j.status}</Badge></TableCell>
                  <TableCell className="max-w-80 truncate pr-4 text-xs text-muted-foreground">{j.error ?? (j.result ? JSON.stringify(j.result) : "")}</TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No syncs yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
