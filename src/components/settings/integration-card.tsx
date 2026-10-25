"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleSlash, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { disconnectIntegration, syncIntegration } from "@/server/actions/integrations";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export type IntegrationView = {
  key: string;
  name: string;
  description: string;
  kind: "oauth" | "env";
  scopes: string[];
  capabilities: { label: string; available: boolean; note?: string }[];
  limitations: string[];
  fallback: string;
  envVars: string[];
  configured: boolean;
  docsUrl: string;
  status: "connected" | "disconnected" | "error" | "expired" | "not_configured";
  account: string | null;
  grantedScopes: string[];
  lastSyncAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  detail: string | null;
};

const STATUS: Record<IntegrationView["status"], { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "text-success" },
  disconnected: { label: "Not connected", tone: "text-muted-foreground" },
  error: { label: "Error", tone: "text-destructive" },
  expired: { label: "Reconnect needed", tone: "text-warning" },
  not_configured: { label: "Not configured", tone: "text-muted-foreground" },
};

export function IntegrationCard({ i, isDemo }: { i: IntegrationView; isDemo: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const s = STATUS[i.status];
  const canConnect = i.kind === "oauth" && i.configured && !isDemo;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {i.name}
          <Badge variant="outline" className={cn("gap-1 font-normal", s.tone)}>
            {i.status === "connected" ? <CheckCircle2 className="size-3" /> : <CircleSlash className="size-3" />}
            {s.label}
          </Badge>
        </CardTitle>
        <CardDescription>{i.description}</CardDescription>
        {i.docsUrl && (
          <CardAction>
            <Button asChild size="icon-xs" variant="ghost" aria-label={`${i.name} documentation`}>
              <a href={i.docsUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {(i.account || i.lastSyncAt || i.detail) && (
          <dl className="grid grid-cols-2 gap-2 text-xs">
            {i.account && (
              <div>
                <dt className="text-muted-foreground">Account</dt>
                <dd>{i.account}</dd>
              </div>
            )}
            {i.detail && (
              <div>
                <dt className="text-muted-foreground">Configuration</dt>
                <dd>{i.detail}</dd>
              </div>
            )}
            {i.kind === "oauth" && i.status !== "not_configured" && (
              <div>
                <dt className="text-muted-foreground">Last successful sync</dt>
                <dd>{i.lastSyncAt ? <span title={fmtDateTime(i.lastSyncAt)}>{fmtRelative(i.lastSyncAt)}</span> : "Never"}</dd>
              </div>
            )}
          </dl>
        )}
        {i.lastError && (
          <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-destructive">
            {i.lastError}
            {i.lastErrorAt ? ` · ${fmtRelative(i.lastErrorAt)}` : ""}
          </p>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Features</p>
          <ul className="space-y-1">
            {i.capabilities.map((c) => (
              <li key={c.label} className="flex gap-2 text-xs">
                {c.available ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                <span className={cn(!c.available && "text-muted-foreground")}>
                  {c.label}
                  {c.note && <span className="block text-muted-foreground">{c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {i.scopes.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Permissions requested</p>
            <div className="flex flex-wrap gap-1">
              {i.scopes.map((sc) => (
                <Badge key={sc} variant={i.grantedScopes.includes(sc) ? "secondary" : "outline"} className="font-mono text-[10px] font-normal">
                  {sc.replace("https://www.googleapis.com/auth/", "")}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {i.limitations.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {i.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Without it:</span> {i.fallback}
        </p>
        {!i.configured && i.envVars.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Set <span className="font-mono">{i.envVars.join(", ")}</span> on the server to enable it.
          </p>
        )}
      </CardContent>
      {i.kind === "oauth" && (
        <CardFooter className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          {i.status === "connected" ? (
            <>
              {i.key === "x" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    start(async () => {
                      const res = await syncIntegration({ provider: "x" });
                      if (res.ok) toast.success(`Synced ${res.data.posts} posts (${res.data.imported} new)`);
                      else toast.error(res.error);
                      router.refresh();
                    })
                  }
                >
                  {busy ? <Spinner /> : <RefreshCw />} Sync now
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Unplug /> Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {i.name}?</AlertDialogTitle>
                    <AlertDialogDescription>We'll revoke the access token and delete it. Data already synced stays in your workspace.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        start(async () => {
                          const res = await disconnectIntegration({ provider: i.key as "x" });
                          if (res.ok) toast.success(`${i.name} disconnected`);
                          else toast.error(res.error);
                          router.refresh();
                        })
                      }
                    >
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : canConnect ? (
            <Button asChild size="sm">
              <a href={`/api/integrations/${i.key}/connect`}>{i.status === "expired" || i.status === "error" ? "Reconnect" : "Connect"}</a>
            </Button>
          ) : (
            <Button size="sm" disabled>
              {isDemo ? "Not available in the demo" : "Configure server first"}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
