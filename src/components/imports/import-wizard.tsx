"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { applyMapping, CONTENT_FIELDS, guessMapping, PROSPECT_FIELDS } from "@/lib/domain/csv-import";
import { commitContentImport, commitProspectImport, previewContentImport, previewProspectImport } from "@/server/actions/imports";

type Kind = "prospects" | "content";
type PreviewRow = { index: number; errors: string[]; label: string; detail: string; duplicate: string | null; ok: boolean };

export function ImportWizard({ kind, statuses }: { kind: Kind; statuses?: { key: string; label: string }[] }) {
  const router = useRouter();
  const fields = kind === "prospects" ? PROSPECT_FIELDS : CONTENT_FIELDS;
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("new");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const mapped = useMemo(() => applyMapping(raw, mapping), [raw, mapping]);
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key] && !(f.key === "fullName" && mapping.firstName));

  function onFile(file: File) {
    if (file.size > 5_000_000) return toast.error("File is larger than 5 MB. Split it into smaller files.");
    setResult(null);
    setPreview(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        if (!hs.length) return toast.error("Couldn't find a header row in this file.");
        if (res.data.length > 2000) toast.warning(`Only the first 2,000 of ${res.data.length} rows will be imported.`);
        setFileName(file.name);
        setHeaders(hs);
        setRaw(res.data.slice(0, 2000));
        setMapping(guessMapping(hs, fields));
      },
      error: () => toast.error("Couldn't read that file. Is it a valid CSV?"),
    });
  }

  function runPreview() {
    start(async () => {
      if (kind === "prospects") {
        const res = await previewProspectImport({ rows: mapped });
        if (!res.ok) return void toast.error(res.error);
        const rows = res.data.map((r) => ({
          index: r.index,
          errors: r.errors,
          label: r.data?.fullName ?? "—",
          detail: [r.data?.company, r.data?.email].filter(Boolean).join(" · "),
          duplicate: r.duplicateOf ? `Matches ${r.duplicateOf.fullName} (${r.duplicateOf.reason.replace("_", " + ")})` : r.duplicateInFile !== null ? `Same as row ${r.duplicateInFile + 2}` : null,
          ok: !r.errors.length && !r.duplicateOf && r.duplicateInFile === null,
        }));
        setPreview(rows);
        setInclude(new Set(rows.filter((r) => r.ok).map((r) => r.index)));
      } else {
        const res = await previewContentImport({ rows: mapped });
        if (!res.ok) return void toast.error(res.error);
        const rows = res.data.map((r) => ({
          index: r.index,
          errors: r.errors,
          label: r.data?.title ?? "—",
          detail: r.data ? `${r.data.platform === "x" ? "X" : "LinkedIn"} · ${new Date(r.data.publishedAt).toLocaleDateString()}` : "",
          duplicate: r.duplicate ? "Already in your library (same URL)" : null,
          ok: !r.errors.length && !r.duplicate,
        }));
        setPreview(rows);
        setInclude(new Set(rows.filter((r) => r.ok).map((r) => r.index)));
      }
    });
  }

  function commit() {
    start(async () => {
      const res =
        kind === "prospects"
          ? await commitProspectImport({ rows: mapped, include: [...include], status })
          : await commitContentImport({ rows: mapped, include: [...include] });
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data);
      toast.success(`Imported ${res.data.inserted} ${kind === "prospects" ? "prospects" : "posts"}`);
      router.refresh();
    });
  }

  const counts = preview && { ok: preview.filter((r) => r.ok).length, errors: preview.filter((r) => r.errors.length).length, dupes: preview.filter((r) => r.duplicate).length };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a CSV file</CardTitle>
          <CardDescription>
            {kind === "prospects"
              ? "Only import contacts you're allowed to use — your own lists, people who shared details with you, or data from authorized providers."
              : "Export your post history from X or LinkedIn analytics, or any spreadsheet with post text, platform and date. Metrics are stored as source “CSV”."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50">
            <FileUp className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">{fileName ?? "Click to choose a .csv file"}</span>
            <span className="text-xs text-muted-foreground">{fileName ? `${raw.length} rows · ${headers.length} columns` : "Up to 2,000 rows, 5 MB"}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Map columns</CardTitle>
            <CardDescription>We guessed from your headers. Unmapped fields are left empty.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <Field key={f.key}>
                  <FieldLabel>
                    {f.label}
                    {f.required && <span className="text-destructive">*</span>}
                  </FieldLabel>
                  <Select value={mapping[f.key] ?? "__none"} onValueChange={(v) => { setMapping({ ...mapping, [f.key]: v === "__none" ? "" : v }); setPreview(null); }}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Not mapped —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
            {kind === "prospects" && statuses && (
              <Field className="max-w-xs">
                <FieldLabel>Status for imported prospects</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="flex items-center gap-3">
              <Button onClick={runPreview} disabled={busy || missingRequired.length > 0}>
                {busy && !preview ? <Spinner /> : <CheckCircle2 />} Validate & preview
              </Button>
              {missingRequired.length > 0 && <span className="text-xs text-destructive">Map: {missingRequired.map((f) => f.label).join(", ")}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {preview && counts && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>3. Review and import</CardTitle>
            <CardDescription>
              {counts.ok} ready · {counts.dupes} duplicates · {counts.errors} with errors. Duplicates and invalid rows can't be imported.
            </CardDescription>
          </CardHeader>
          <div className="max-h-[480px] overflow-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4" />
                  <TableHead>Row</TableHead>
                  <TableHead>{kind === "prospects" ? "Prospect" : "Post"}</TableHead>
                  <TableHead>Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r) => (
                  <TableRow key={r.index} className={!r.ok ? "bg-muted/30" : undefined}>
                    <TableCell className="pl-4">
                      <Checkbox
                        disabled={!r.ok}
                        checked={include.has(r.index)}
                        onCheckedChange={(c) => {
                          const n = new Set(include);
                          if (c) n.add(r.index);
                          else n.delete(r.index);
                          setInclude(n);
                        }}
                        aria-label={`Include row ${r.index + 2}`}
                      />
                    </TableCell>
                    <TableCell className="num text-muted-foreground">{r.index + 2}</TableCell>
                    <TableCell className="max-w-80">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
                    </TableCell>
                    <TableCell>
                      {r.errors.length ? (
                        <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                      ) : r.duplicate ? (
                        <Badge variant="outline" className="gap-1 text-warning"><AlertTriangle className="size-3" />{r.duplicate}</Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-success"><CheckCircle2 className="size-3" />Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center gap-3 border-t px-4 py-3">
            <Button onClick={commit} disabled={busy || include.size === 0}>
              {busy ? <Spinner /> : <Upload />} Import {include.size} {kind === "prospects" ? "prospects" : "posts"}
            </Button>
            <span className="text-xs text-muted-foreground">Rows are validated again on the server before saving.</span>
          </div>
        </Card>
      )}

      {result && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Import finished</AlertTitle>
          <AlertDescription>
            {result.inserted} imported{result.skipped ? `, ${result.skipped} skipped (duplicates found at save time)` : ""}.{" "}
            <a href={kind === "prospects" ? "/prospects" : "/content/library"} className="underline">View {kind}</a>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
