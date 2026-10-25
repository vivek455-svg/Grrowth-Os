"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, Database, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { askAssistant, runQuickQuestion } from "@/server/actions/assistant";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; input: unknown }[] };

const SUGGESTIONS = [
  "Which posts performed best this month?",
  "What should I post next week?",
  "Which content topics are attracting potential clients?",
  "Which prospects should I contact today?",
  "Show me high-fit SaaS founders I haven't contacted.",
  "Which outreach campaign has the best positive-reply rate?",
  "What are my biggest bottlenecks in converting outreach into projects?",
  "Turn my best-performing post into three new content ideas.",
  "Summarize my progress this week.",
];

/** Renders text with app links (/path) and **bold** as real elements; everything else stays text. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\/(?:prospects|outreach|content|campaigns|follow-ups|opportunities|inbox|reports|discovery|integrations|settings)[^\s)\]]*|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("/") ? (
          <Link key={i} href={p} className="font-medium underline underline-offset-2">
            {p}
          </Link>
        ) : p.startsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function ResultView({ result }: { result: unknown }) {
  // Generic, readable rendering of tool JSON for the no-AI mode.
  if (!result || typeof result !== "object") return <p className="text-sm">{String(result)}</p>;
  const entries = Object.entries(result as Record<string, unknown>);
  return (
    <div className="space-y-3 text-sm">
      {entries.map(([k, v]) =>
        Array.isArray(v) ? (
          <div key={k}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{k}</p>
            {v.length === 0 ? (
              <p className="text-muted-foreground">None</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {v.map((row, i) => (
                  <li key={i} className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2">
                    {Object.entries(row as Record<string, unknown>)
                      .filter(([kk]) => !["id", "contentItemId", "prospectId"].includes(kk))
                      .map(([kk, vv]) =>
                        kk === "url" || kk === "link" ? (
                          <Link key={kk} href={String(vv)} className="text-xs underline">open</Link>
                        ) : (
                          <span key={kk} className="text-xs">
                            <span className="text-muted-foreground">{kk}: </span>
                            {vv === null ? "—" : typeof vv === "number" && !Number.isInteger(vv) ? (vv < 1 ? `${(vv * 100).toFixed(1)}%` : vv.toFixed(2)) : String(vv)}
                          </span>
                        ),
                      )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : typeof v === "object" && v !== null ? (
          <div key={k}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{k}</p>
            <pre className="overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs">{JSON.stringify(v, null, 2)}</pre>
          </div>
        ) : (
          <p key={k} className="text-xs">
            <span className="text-muted-foreground">{k}: </span>
            {String(v ?? "—")}
          </p>
        ),
      )}
    </div>
  );
}

export function AssistantChat({ aiEnabled, quick }: { aiEnabled: boolean; quick: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [quickResult, setQuickResult] = useState<{ label: string; result: unknown } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, pending]);

  function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    start(async () => {
      const res = await askAssistant({ messages: next.map(({ role, content }) => ({ role, content })) });
      if (res.ok) setMessages([...next, { role: "assistant", content: res.data.text || "I couldn't find anything to say about that.", tools: res.data.toolsUsed }]);
      else setError(res.error);
    });
  }

  if (!aiEnabled)
    return (
      <div className="space-y-4">
        <Alert>
          <Sparkles />
          <AlertDescription>
            Free-form questions need an AI provider (<Link href="/integrations" className="underline">connect one</Link>). Meanwhile these answers come straight from your data.
          </AlertDescription>
        </Alert>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-1.5">
            {quick.map((q, i) => (
              <Button
                key={q}
                variant={quickResult?.label === q ? "secondary" : "outline"}
                className="h-auto justify-start py-2 text-left whitespace-normal"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await runQuickQuestion({ index: i });
                    if (res.ok) setQuickResult(res.data);
                    else setError(res.error);
                  })
                }
              >
                {q}
              </Button>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{quickResult?.label ?? "Pick a question"}</CardTitle>
              <CardDescription>Computed from your records. Periods and sample sizes are included.</CardDescription>
            </CardHeader>
            <CardContent className={cn(pending && "opacity-60")}>{quickResult ? <ResultView result={quickResult.result} /> : <p className="text-sm text-muted-foreground">Results appear here.</p>}</CardContent>
          </Card>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {messages.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Ask about your content, prospects, campaigns or pipeline. Answers use your actual records, and the assistant can't change anything.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-4" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" && "justify-end")}>
            <div className={cn("max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-card")}>
              <div className="whitespace-pre-wrap">{m.role === "assistant" ? <RichText text={m.content} /> : m.content}</div>
              {m.tools && m.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
                  <Database className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Data used:</span>
                  {m.tools.map((t, j) => (
                    <Badge key={j} variant="outline" className="font-mono text-[10px] font-normal" title={JSON.stringify(t.input)}>
                      {t.name}
                      {(t.input as { range?: string })?.range ? `(${(t.input as { range: string }).range})` : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <p className="text-xs text-muted-foreground">Looking at your data…</p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div ref={bottom} />
      </div>
      <form
        className="sticky bottom-4 rounded-lg border bg-card p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="Ask about your content, prospects or pipeline…"
          className="min-h-12 resize-none border-0 shadow-none focus-visible:ring-0"
          aria-label="Message"
        />
        <div className="flex items-center justify-between">
          <span className="px-1 text-xs text-muted-foreground">Read-only · Enter to send</span>
          <div className="flex gap-1">
            {messages.length > 0 && (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => setMessages([])} aria-label="New conversation">
                <RotateCcw />
              </Button>
            )}
            <Button type="submit" size="icon-sm" disabled={pending || !input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
