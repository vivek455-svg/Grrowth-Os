import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Inbox, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { MessageStatusBadge } from "@/components/app/badges";
import { LogInteractionButton } from "@/components/prospects/log-interaction-button";
import { SentimentSelect } from "@/components/outreach/sentiment-select";
import { loadForUser } from "@/server/page";
import { connectedChannels, inboxEvents, messagesByStatus } from "@/server/queries/outreach";
import { fmtDateTime, fmtRelative, truncate } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Outreach Inbox" };

const VIEWS = [
  ["all", "All activity"],
  ["replies", "Replies"],
  ["sent", "Sent"],
  ["drafts", "Review queue"],
  ["failed", "Failed"],
] as const;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? (sp.view as string) : "all";
  const data = await loadForUser(async (tx) => ({
    events: view === "drafts" || view === "failed" ? [] : await inboxEvents(tx, view),
    messages: view === "drafts" ? await messagesByStatus(tx, ["draft", "approved"]) : view === "failed" ? await messagesByStatus(tx, ["failed", "bounced"]) : [],
    channels: await connectedChannels(tx),
  }));
  const gmail = data.channels.gmail?.status === "connected";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Outreach Inbox"
        description="Every conversation across email, LinkedIn and X in one timeline."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/outreach/compose">Draft outreach</Link>
            </Button>
            <LogInteractionButton />
          </>
        }
      />
      <Alert>
        <Info />
        <AlertDescription>
          {gmail ? "Emails you send through Gmail are recorded automatically. " : "No email account connected. "}
          Replies aren't read automatically: that needs Google's restricted gmail.readonly scope, and LinkedIn and X don't offer DM access. Log replies with <span className="font-medium">Log interaction</span>. Entries are labelled <span className="font-medium">Synced</span> or <span className="font-medium">Logged manually</span>.
        </AlertDescription>
      </Alert>
      <Tabs value={view}>
        <TabsList>
          {VIEWS.map(([k, label]) => (
            <TabsTrigger key={k} value={k} asChild>
              <Link href={k === "all" ? "/inbox" : `/inbox?view=${k}`}>{label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {(view === "drafts" || view === "failed") &&
        (data.messages.length === 0 ? (
          <EmptyState icon={Inbox} title={view === "drafts" ? "Nothing waiting for review" : "No failed messages"} description={view === "drafts" ? "Drafts you save in the composer appear here until you approve and send them." : "Messages that failed to send appear here with the error."} />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {data.messages.map(({ m, prospectName, company, campaign }) => (
                <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/prospects/${m.prospectId}`} className="font-medium hover:underline">{prospectName}</Link>
                      {company && <span className="text-xs text-muted-foreground">{company}</span>}
                      <MessageStatusBadge status={m.status} />
                      <span className="text-xs text-muted-foreground">{CHANNEL_LABEL[m.channel]}{campaign ? ` · ${campaign}` : ""}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{m.body}</p>
                    {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                  </div>
                  <Button asChild size="xs" variant="outline">
                    <Link href={`/outreach/compose?prospect=${m.prospectId}&message=${m.id}`}>{m.status === "draft" ? "Review" : "Open"}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))}

      {view !== "drafts" && view !== "failed" &&
        (data.events.length === 0 ? (
          <EmptyState icon={Inbox} title="No conversations yet" description="Sent messages, replies and notes appear here as you log or send them." />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {data.events.map(({ e, prospectName, company, campaign }) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                      e.direction === "inbound" ? "border-info/40 text-info" : "text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {e.direction === "inbound" ? <ArrowDownLeft className="size-3.5" /> : e.direction === "outbound" ? <ArrowUpRight className="size-3.5" /> : <Info className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/prospects/${e.prospectId}`} className="font-medium hover:underline">{prospectName}</Link>
                      {company && <span className="text-xs text-muted-foreground">{company}</span>}
                      <span className="text-xs text-muted-foreground">· {EVENT_LABEL[e.type]}{e.channel ? ` (${CHANNEL_LABEL[e.channel]})` : ""}</span>
                      {campaign && <Badge variant="outline" className="font-normal">{campaign}</Badge>}
                      {e.source !== "system" && (
                        <Badge variant="outline" className={cn("font-normal", e.source === "manual" && "border-dashed")}>{e.source === "synced" ? "Synced" : "Logged manually"}</Badge>
                      )}
                      <span className="num ml-auto text-xs text-muted-foreground" title={fmtDateTime(e.occurredAt)}>{fmtRelative(e.occurredAt)}</span>
                    </div>
                    {e.content && <p className="text-sm text-muted-foreground">{truncate(e.content, 280)}</p>}
                    {e.direction === "inbound" && <SentimentSelect id={e.id} value={e.sentiment} />}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
