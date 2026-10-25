"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileUp, LayoutDashboard, Plug, Plus, Upload, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { completeOnboarding } from "@/server/actions/settings";
import { cn } from "@/lib/utils";

const SERVICES = [
  "Conversion-focused landing pages",
  "Framer website design & development",
  "Figma-to-Framer implementation",
  "Framer migrations",
  "Website improvements & audits",
  "Agency Framer development partnerships",
];
const AUDIENCES = ["B2B SaaS founders", "Startup marketing leads", "Design agencies and studios", "Product-led startups", "Modern service businesses"];
const PILLARS = [
  "Landing page teardowns",
  "Website conversion principles",
  "Framer development tips",
  "Design process & behind-the-scenes",
  "Project breakdowns & case studies",
  "Personal learning & opinions",
  "Client problems & website solutions",
];

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              on ? "border-foreground/30 bg-secondary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {on && <Check className="size-3.5" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function AddCustom({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { e.preventDefault(); onAdd(v.trim()); setV(""); } }} />
      <Button type="button" variant="outline" disabled={!v.trim()} onClick={() => { onAdd(v.trim()); setV(""); }}>
        <Plus /> Add
      </Button>
    </div>
  );
}

const STEPS = ["Business", "Portfolio", "Audiences", "Pillars", "Integrations", "Get started"];

export function OnboardingWizard({ defaults, configured }: { defaults: { fullName: string; email: string | null }; configured: { ai: boolean; x: boolean; linkedin: boolean; gmail: boolean } }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    fullName: defaults.fullName,
    businessName: "",
    positioning: "Web designer and official Framer Expert. I design and build conversion-focused landing pages for B2B SaaS companies, startups and design agencies.",
    services: SERVICES.slice(0, 4),
    targetAudiences: AUDIENCES.slice(0, 3),
    writingPreferences: "Simple, clear English. Short sentences. Specific observations. No hype.",
    pillars: PILLARS.slice(0, 5),
    portfolio: [] as { name: string; url: string }[],
  });
  const [pName, setPName] = useState("");
  const [pUrl, setPUrl] = useState("");

  function finish(to: string) {
    start(async () => {
      const res = await completeOnboarding({ ...v, portfolio: v.portfolio.map((p) => ({ name: p.name, url: p.url || null })) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push(to);
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
          {step < STEPS.length - 1 && (
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => setStep(STEPS.length - 1)}>
              Skip setup
            </button>
          )}
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Onboarding progress" />
      </div>

      <Card>
        {step === 0 && (
          <>
            <CardHeader>
              <CardTitle>Tell us about your business</CardTitle>
              <CardDescription>This shapes how drafts sound and how prospects are matched to your services.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ob-name">Your name</FieldLabel>
                    <Input id="ob-name" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ob-biz">Business name</FieldLabel>
                    <Input id="ob-biz" value={v.businessName} onChange={(e) => setV({ ...v, businessName: e.target.value })} placeholder="Optional" />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="ob-pos">Positioning</FieldLabel>
                  <Textarea id="ob-pos" rows={3} value={v.positioning} onChange={(e) => setV({ ...v, positioning: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>Services</FieldLabel>
                  <Chips options={[...new Set([...SERVICES, ...v.services])]} value={v.services} onChange={(services) => setV({ ...v, services })} />
                  <AddCustom placeholder="Add a service" onAdd={(x) => setV({ ...v, services: [...v.services, x] })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ob-wp">How you like to write</FieldLabel>
                  <Textarea id="ob-wp" rows={2} value={v.writingPreferences} onChange={(e) => setV({ ...v, writingPreferences: e.target.value })} />
                </Field>
              </FieldGroup>
            </CardContent>
          </>
        )}
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>Add portfolio links</CardTitle>
              <CardDescription>Outreach can point to relevant work. You can add verified results later in Settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {v.portfolio.map((p, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="truncate text-muted-foreground">{p.url}</span>
                  <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Remove" onClick={() => setV({ ...v, portfolio: v.portfolio.filter((_, j) => j !== i) })}>
                    <XIcon />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="Project name" value={pName} onChange={(e) => setPName(e.target.value)} aria-label="Project name" />
                <Input placeholder="https://" value={pUrl} onChange={(e) => setPUrl(e.target.value)} aria-label="Project URL" />
                <Button
                  variant="outline"
                  disabled={!pName.trim() || (!!pUrl && !/^https?:\/\/\S+\.\S+/.test(pUrl))}
                  onClick={() => {
                    setV({ ...v, portfolio: [...v.portfolio, { name: pName.trim(), url: pUrl.trim() }] });
                    setPName("");
                    setPUrl("");
                  }}
                >
                  <Plus /> Add
                </Button>
              </div>
            </CardContent>
          </>
        )}
        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>Who do you want to work with?</CardTitle>
              <CardDescription>Used for content ideas and prospect fit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Chips options={[...new Set([...AUDIENCES, ...v.targetAudiences])]} value={v.targetAudiences} onChange={(targetAudiences) => setV({ ...v, targetAudiences })} />
              <AddCustom placeholder="Add an audience" onAdd={(x) => setV({ ...v, targetAudiences: [...v.targetAudiences, x] })} />
            </CardContent>
          </>
        )}
        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle>Define your content pillars</CardTitle>
              <CardDescription>Themes you'll post about. Analytics compare performance by pillar. Edit any time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Chips options={[...new Set([...PILLARS, ...v.pillars])]} value={v.pillars} onChange={(pillars) => setV({ ...v, pillars })} />
              <AddCustom placeholder="Add a pillar" onAdd={(x) => setV({ ...v, pillars: [...v.pillars, x] })} />
            </CardContent>
          </>
        )}
        {step === 4 && (
          <>
            <CardHeader>
              <CardTitle>Connect what you have — or skip</CardTitle>
              <CardDescription>Everything works without integrations. You can connect accounts later on the Integrations page.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {[
                  ["AI provider", configured.ai, "Drafting, research summaries and the assistant"],
                  ["X", configured.x, "Publish posts and sync your post metrics"],
                  ["LinkedIn", configured.linkedin, "Publish text posts"],
                  ["Gmail", configured.gmail, "Send approved outreach emails"],
                ].map(([name, ok, desc]) => (
                  <li key={name as string} className="flex items-center gap-3 rounded-md border px-3 py-2.5">
                    <Plug className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name as string}</p>
                      <p className="text-xs text-muted-foreground">{desc as string}</p>
                    </div>
                    <Badge variant="outline" className="font-normal">{ok ? "Available" : "Needs server setup"}</Badge>
                  </li>
                ))}
              </ul>
              <FieldDescription className="mt-3">You'll be able to connect accounts after setup.</FieldDescription>
            </CardContent>
          </>
        )}
        {step === 5 && (
          <>
            <CardHeader>
              <CardTitle>Your workspace is ready</CardTitle>
              <CardDescription>Bring in what you already have, or start fresh.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              <Button variant="outline" className="h-auto flex-col gap-2 py-4" disabled={pending} onClick={() => finish("/content/import")}>
                <FileUp /> Import past posts
              </Button>
              <Button variant="outline" className="h-auto flex-col gap-2 py-4" disabled={pending} onClick={() => finish("/prospects/import")}>
                <Upload /> Import prospects
              </Button>
              <Button className="h-auto flex-col gap-2 py-4" disabled={pending} onClick={() => finish("/")}>
                {pending ? <Spinner /> : <LayoutDashboard />} Go to dashboard
              </Button>
            </CardContent>
          </>
        )}
        {step < 5 && (
          <CardFooter className="justify-between border-t pt-4">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={() => setStep(step + 1)}>
              Continue <ArrowRight />
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
