"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { deleteAccount, deletePortfolioProject, savePortfolioProject, updateProfile } from "@/server/actions/settings";
import { archivePillar, savePillar } from "@/server/actions/content";
import { addLeadStatus, deleteLeadStatus, renameLeadStatus } from "@/server/actions/pipeline";
import { addSuppression, removeSuppression } from "@/server/actions/prospects";
import { useAction } from "@/hooks/use-action";
import { fmtDateTime } from "@/lib/format";
import type { Profile } from "@/db/schema";

type Props = {
  profile: Profile;
  portfolio: { id: string; name: string; url: string | null; description: string | null; verifiedOutcomes: string | null }[];
  pillars: { id: string; name: string; description: string | null; archivedAt: Date | null }[];
  statuses: { key: string; label: string; category: string; isSystem: boolean }[];
  suppression: { id: string; email: string | null; domain: string | null; linkedinUrl: string | null; xHandle: string | null; reason: string; createdAt: Date }[];
  audit: { id: string; action: string; entityType: string | null; createdAt: Date; metadata: Record<string, unknown> }[];
  tab: string;
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function ProfileTab({ profile }: { profile: Profile }) {
  const { run, pending } = useAction();
  const [v, setV] = useState({
    fullName: profile.fullName ?? "",
    businessName: profile.businessName ?? "",
    positioning: profile.positioning ?? "",
    services: profile.services.join("\n"),
    targetAudiences: profile.targetAudiences.join("\n"),
    writingPreferences: profile.writingPreferences ?? "",
    timezone: profile.timezone,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business & positioning</CardTitle>
        <CardDescription>The AI uses this to write in your voice and match prospects to your services.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="s-name">Your name</FieldLabel>
              <Input id="s-name" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="s-biz">Business name</FieldLabel>
              <Input id="s-biz" value={v.businessName} onChange={(e) => setV({ ...v, businessName: e.target.value })} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="s-pos">Positioning</FieldLabel>
            <Textarea id="s-pos" rows={3} value={v.positioning} onChange={(e) => setV({ ...v, positioning: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="s-svc">Services (one per line)</FieldLabel>
              <Textarea id="s-svc" rows={5} value={v.services} onChange={(e) => setV({ ...v, services: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="s-aud">Target audiences (one per line)</FieldLabel>
              <Textarea id="s-aud" rows={5} value={v.targetAudiences} onChange={(e) => setV({ ...v, targetAudiences: e.target.value })} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="s-wp">Writing preferences</FieldLabel>
            <Textarea id="s-wp" rows={3} value={v.writingPreferences} onChange={(e) => setV({ ...v, writingPreferences: e.target.value })} placeholder="e.g. Short sentences. No emoji. British spelling." />
          </Field>
          <Field className="max-w-xs">
            <FieldLabel htmlFor="s-tz">Timezone</FieldLabel>
            <Input id="s-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} placeholder="Europe/Berlin" />
          </Field>
          <Button className="w-fit" disabled={pending} onClick={() => run(() => updateProfile({ ...v, services: lines(v.services), targetAudiences: lines(v.targetAudiences) }), { success: "Saved" })}>
            {pending && <Spinner />} Save
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function PortfolioTab({ portfolio }: { portfolio: Props["portfolio"] }) {
  const { run, pending } = useAction();
  const [v, setV] = useState({ name: "", url: "", description: "", verifiedOutcomes: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio projects</CardTitle>
        <CardDescription>Outreach drafts can reference these when relevant. Only results you list as verified are ever mentioned.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-md border">
          {portfolio.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">{p.url}</a>}
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                <p className="text-xs">{p.verifiedOutcomes ? `Verified outcomes: ${p.verifiedOutcomes}` : <span className="text-muted-foreground">No verified outcomes</span>}</p>
              </div>
              <Button size="icon-xs" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => run(() => deletePortfolioProject({ id: p.id }), { success: "Removed" })}>
                <Trash2 />
              </Button>
            </li>
          ))}
          {portfolio.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No projects yet.</li>}
        </ul>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pf-name">Project name</FieldLabel>
            <Input id="pf-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pf-url">URL</FieldLabel>
            <Input id="pf-url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" />
          </Field>
          <Field>
            <FieldLabel htmlFor="pf-desc">What you did</FieldLabel>
            <Input id="pf-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pf-out">Verified outcomes (optional)</FieldLabel>
            <Input id="pf-out" value={v.verifiedOutcomes} onChange={(e) => setV({ ...v, verifiedOutcomes: e.target.value })} placeholder="Only results the client confirmed" />
          </Field>
        </FieldGroup>
        <Button size="sm" disabled={pending || !v.name.trim()} onClick={() => run(() => savePortfolioProject(v), { success: "Project added", onSuccess: () => setV({ name: "", url: "", description: "", verifiedOutcomes: "" }) })}>
          <Plus /> Add project
        </Button>
      </CardContent>
    </Card>
  );
}

function PillarsTab({ pillars }: { pillars: Props["pillars"] }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content pillars</CardTitle>
        <CardDescription>The themes you post about. Archived pillars keep their historical data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {pillars.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Input value={edits[p.id] ?? p.name} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })} disabled={!!p.archivedAt} aria-label={`Pillar ${p.name}`} />
              {edits[p.id] !== undefined && edits[p.id] !== p.name && (
                <Button size="sm" disabled={pending} onClick={() => run(() => savePillar({ id: p.id, name: edits[p.id]!, description: p.description }), { success: "Renamed" })}>Save</Button>
              )}
              {p.archivedAt && <Badge variant="outline">Archived</Badge>}
              <Button size="icon-sm" variant="ghost" aria-label={p.archivedAt ? "Restore" : "Archive"} onClick={() => run(() => archivePillar({ id: p.id, archived: !p.archivedAt }), { success: p.archivedAt ? "Restored" : "Archived" })}>
                {p.archivedAt ? <ArchiveRestore /> : <Archive />}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input placeholder="New pillar, e.g. Framer development tips" value={name} onChange={(e) => setName(e.target.value)} aria-label="New pillar" />
          <Button disabled={pending || !name.trim()} onClick={() => run(() => savePillar({ name }), { success: "Pillar added", onSuccess: () => setName("") })}>
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusesTab({ statuses }: { statuses: Props["statuses"] }) {
  const { run, pending } = useAction();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("active");
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead statuses</CardTitle>
        <CardDescription>Built-in statuses can be renamed. Custom ones can be added and removed. “Excluded” statuses block outreach.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {statuses.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <Input value={edits[s.key] ?? s.label} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} aria-label={`Status ${s.label}`} />
              <Badge variant="outline" className="w-20 justify-center font-normal">{s.category}</Badge>
              {edits[s.key] !== undefined && edits[s.key] !== s.label && (
                <Button size="sm" disabled={pending} onClick={() => run(() => renameLeadStatus({ key: s.key, label: edits[s.key]! }), { success: "Renamed" })}>Save</Button>
              )}
              {!s.isSystem && (
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.label}`} onClick={() => run(() => deleteLeadStatus({ key: s.key }), { success: "Deleted" })}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-48 flex-1" placeholder="Custom status, e.g. Partner intro" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="New status" />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="excluded">Excluded</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={pending || !label.trim()} onClick={() => run(() => addLeadStatus({ label, category: category as "open" }), { success: "Status added", onSuccess: () => setLabel("") })}>
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsAndSafetyTab({ profile, suppression }: { profile: Profile; suppression: Props["suppression"] }) {
  const { run, pending } = useAction();
  const [den, setDen] = useState(profile.engagementRateDenominator);
  const [cooldown, setCooldown] = useState(String(profile.outreachCooldownDays));
  const [limit, setLimit] = useState(String(profile.dailySendLimit));
  const [s, setS] = useState({ email: "", domain: "", linkedinUrl: "", xHandle: "" });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Engagement rate</CardTitle>
          <CardDescription>Engagements = reactions + replies + reposts + bookmarks. Choose what to divide by.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <RadioGroup value={den} onValueChange={(x) => setDen(x as typeof den)}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="impressions" id="den-i" className="mt-0.5" />
              <Label htmlFor="den-i" className="font-normal">
                <span className="font-medium">Impressions</span> — how engaging the post was for the people who saw it (recommended).
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="followers" id="den-f" className="mt-0.5" />
              <Label htmlFor="den-f" className="font-normal">
                <span className="font-medium">Followers at publication</span> — needs follower counts recorded around each post.
              </Label>
            </div>
          </RadioGroup>
          <Button size="sm" disabled={pending} onClick={() => run(() => updateProfile({ engagementRateDenominator: den }), { success: "Saved" })}>Save</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Outreach safety</CardTitle>
          <CardDescription>Applied before any message is approved or sent.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cd">Duplicate-contact cooldown (days)</FieldLabel>
              <Input id="cd" type="number" min={0} max={365} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
              <FieldDescription>Blocks a new first message to someone contacted within this window.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="dl">Daily email send limit</FieldLabel>
              <Input id="dl" type="number" min={0} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} />
              <FieldDescription>Maximum emails sent through Gmail per day.</FieldDescription>
            </Field>
            <Button size="sm" className="w-fit" disabled={pending} onClick={() => run(() => updateProfile({ outreachCooldownDays: Number(cooldown), dailySendLimit: Number(limit) }), { success: "Saved" })}>Save</Button>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Suppression list</CardTitle>
          <CardDescription>People and domains you must never contact. Opt-outs and “Do not contact” are added automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="email@company.com" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} aria-label="Email" />
            <Input placeholder="company.com" value={s.domain} onChange={(e) => setS({ ...s, domain: e.target.value })} aria-label="Domain" />
            <Input placeholder="LinkedIn URL" value={s.linkedinUrl} onChange={(e) => setS({ ...s, linkedinUrl: e.target.value })} aria-label="LinkedIn URL" />
            <Input placeholder="@xhandle" value={s.xHandle} onChange={(e) => setS({ ...s, xHandle: e.target.value })} aria-label="X handle" />
          </div>
          <Button size="sm" disabled={pending} onClick={() => run(() => addSuppression({ ...s, reason: "manual" }), { success: "Added to suppression list", onSuccess: () => setS({ email: "", domain: "", linkedinUrl: "", xHandle: "" }) })}>
            <Plus /> Add
          </Button>
          <ul className="divide-y rounded-md border">
            {suppression.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{x.email ?? x.domain ?? x.linkedinUrl ?? x.xHandle ?? "Linked prospect"}</span>
                <Badge variant="outline" className="font-normal">{x.reason.replace("_", " ")}</Badge>
                <span className="hidden text-xs text-muted-foreground sm:inline">{fmtDateTime(x.createdAt)}</span>
                <Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => run(() => removeSuppression({ id: x.id }), { success: "Removed" })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {suppression.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Empty.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function DataTab({ audit, isDemo }: { audit: Props["audit"]; isDemo: boolean }) {
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>Download your data at any time.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            ["all", "Everything (JSON)"],
            ["prospects", "Prospects (CSV)"],
            ["content", "Content (CSV)"],
            ["campaigns", "Campaigns (CSV)"],
            ["opportunities", "Opportunities (CSV)"],
          ].map(([k, l]) => (
            <Button key={k} asChild variant="outline" size="sm">
              <a href={`/api/export/${k}`}>
                <Download /> {l}
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Sends, publications, deletions, imports and integration changes. Entries can't be edited.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="pr-4">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="num pl-4 text-muted-foreground">{fmtDateTime(a.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="max-w-72 truncate pr-4 text-xs text-muted-foreground">{Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : (a.entityType ?? "")}</TableCell>
                </TableRow>
              ))}
              {audit.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">No entries yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">{isDemo ? "Reset demo workspace" : "Delete account"}</CardTitle>
          <CardDescription>
            {isDemo ? "Removes all sample data and restarts onboarding with an empty workspace." : "Permanently deletes your account, all records, and stored integration tokens. Export first if you need a copy."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 /> {isDemo ? "Reset workspace" : "Delete account"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>This can't be undone</AlertDialogTitle>
                <AlertDialogDescription>Type DELETE to confirm.</AlertDialogDescription>
              </AlertDialogHeader>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  disabled={confirm !== "DELETE" || pending}
                  onClick={(e) => {
                    e.preventDefault();
                    start(async () => {
                      const res = await deleteAccount({ confirm });
                      if (res && !res.ok) toast.error(res.error);
                    });
                  }}
                >
                  {pending && <Spinner />} Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsView(props: Props) {
  return (
    <Tabs defaultValue={props.tab} className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
        <TabsTrigger value="pillars">Content pillars</TabsTrigger>
        <TabsTrigger value="statuses">Lead statuses</TabsTrigger>
        <TabsTrigger value="safety">Metrics & safety</TabsTrigger>
        <TabsTrigger value="data">Data & audit</TabsTrigger>
      </TabsList>
      <TabsContent value="profile"><ProfileTab profile={props.profile} /></TabsContent>
      <TabsContent value="portfolio"><PortfolioTab portfolio={props.portfolio} /></TabsContent>
      <TabsContent value="pillars"><PillarsTab pillars={props.pillars} /></TabsContent>
      <TabsContent value="statuses"><StatusesTab statuses={props.statuses} /></TabsContent>
      <TabsContent value="safety"><MetricsAndSafetyTab profile={props.profile} suppression={props.suppression} /></TabsContent>
      <TabsContent value="data"><DataTab audit={props.audit} isDemo={props.profile.isDemo} /></TabsContent>
    </Tabs>
  );
}
