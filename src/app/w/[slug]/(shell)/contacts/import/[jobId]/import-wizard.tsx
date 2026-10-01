"use client";

import { useState, useTransition } from "react";
import { FormField } from "@/components/app/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STANDARD_FIELDS, type ColumnTarget } from "@/lib/contacts/fields";
import type { ImportPreview } from "@/server/contacts/imports";
import { previewImportAction, runImportAction } from "../../actions";

interface Option {
  id: string;
  name: string;
}

export function ImportWizard({
  slug,
  jobId,
  headers,
  sample,
  warnings,
  rowCount,
  suggested,
  customFields,
  tags,
  lists,
  countries,
  defaultCountry,
}: {
  slug: string;
  jobId: string;
  headers: string[];
  sample: string[][];
  warnings: string[];
  rowCount: number;
  suggested: ColumnTarget[];
  customFields: { key: string; label: string }[];
  tags: Option[];
  lists: Option[];
  countries: { code: string; name: string; callingCode: string }[];
  defaultCountry: string | null;
}) {
  const [mapping, setMapping] = useState<ColumnTarget[]>(suggested);
  const [options, setOptions] = useState({
    defaultCountry: defaultCountry ?? "",
    defaultOptInStatus: "UNKNOWN",
    optInSource: "",
    duplicateStrategy: "update",
    tagIds: [] as string[],
    listId: "",
  });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const change = (fn: () => void) => {
    setPreview(null);
    fn();
  };
  const targetsInUse = new Set(mapping.filter(Boolean));

  const validate = () =>
    start(async () => {
      setError(null);
      const res = await previewImportAction(slug, jobId, { mapping, options });
      if (res.ok) setPreview(res.preview);
      else setError(res.message);
    });

  const run = () =>
    start(async () => {
      setError(null);
      const res = await runImportAction(slug, jobId, { mapping, options });
      if (res && !res.ok) {
        setConfirm(false);
        setError(res.message);
      }
    });

  const importCount = preview
    ? preview.newCount + (options.duplicateStrategy === "update" ? preview.existingCount : 0)
    : 0;

  return (
    <div className="grid gap-4">
      {warnings.length > 0 && (
        <Alert>
          <AlertTitle>Check your file</AlertTitle>
          <AlertDescription>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card className="py-0">
        <CardHeader className="pt-5">
          <CardTitle>1. Map columns</CardTitle>
          <CardDescription>
            Choose which contact field each column fills. Columns set to “Don&apos;t import” are ignored.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Column in file</TableHead>
                <TableHead>Sample values</TableHead>
                <TableHead className="pr-5">Import as</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {headers.map((h, i) => (
                <TableRow key={`${h}-${i}`}>
                  <TableCell className="pl-5 font-medium">{h}</TableCell>
                  <TableCell className="text-muted-foreground max-w-72 truncate">
                    {sample
                      .map((r) => r[i])
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(", ")}
                  </TableCell>
                  <TableCell className="pr-5">
                    <NativeSelect
                      aria-label={`Import column ${h} as`}
                      value={mapping[i] ?? ""}
                      onChange={(e) =>
                        change(() =>
                          setMapping((m) => m.map((t, j) => (j === i ? (e.target.value as ColumnTarget) : t))),
                        )
                      }
                    >
                      <option value="">Don&apos;t import</option>
                      {STANDARD_FIELDS.map((f) => (
                        <option key={f.key} value={f.key} disabled={targetsInUse.has(f.key) && mapping[i] !== f.key}>
                          {f.label}
                        </option>
                      ))}
                      {customFields.map((f) => (
                        <option
                          key={f.key}
                          value={`custom:${f.key}`}
                          disabled={targetsInUse.has(`custom:${f.key}`) && mapping[i] !== `custom:${f.key}`}
                        >
                          Custom: {f.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Options</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="defaultCountry" label="Default country" hint="Used for numbers without a country code.">
            <NativeSelect
              id="defaultCountry"
              value={options.defaultCountry}
              onChange={(e) => change(() => setOptions({ ...options, defaultCountry: e.target.value }))}
            >
              <option value="">None (numbers must include +country code)</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} (+{c.callingCode})
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="duplicateStrategy" label="Existing contacts (same phone number)">
            <NativeSelect
              id="duplicateStrategy"
              value={options.duplicateStrategy}
              onChange={(e) => change(() => setOptions({ ...options, duplicateStrategy: e.target.value }))}
            >
              <option value="update">Update them with values from the file</option>
              <option value="skip">Skip them</option>
            </NativeSelect>
          </FormField>
          <FormField
            id="defaultOptInStatus"
            label="Opt-in status"
            hint={
              targetsInUse.has("optInStatus")
                ? "Used when the opt-in column is empty."
                : "Applied to every new contact in this file."
            }
          >
            <NativeSelect
              id="defaultOptInStatus"
              value={options.defaultOptInStatus}
              onChange={(e) => change(() => setOptions({ ...options, defaultOptInStatus: e.target.value }))}
            >
              <option value="UNKNOWN">Unknown</option>
              <option value="OPTED_IN">Opted in</option>
              <option value="OPTED_OUT">Opted out</option>
            </NativeSelect>
          </FormField>
          <FormField
            id="optInSource"
            label="Opt-in source"
            hint="Recorded on opted-in contacts, e.g. website signup form."
          >
            <Input
              id="optInSource"
              value={options.optInSource}
              onChange={(e) => change(() => setOptions({ ...options, optInSource: e.target.value }))}
            />
          </FormField>
          {lists.length > 0 && (
            <FormField id="listId" label="Add to list">
              <NativeSelect
                id="listId"
                value={options.listId}
                onChange={(e) => change(() => setOptions({ ...options, listId: e.target.value }))}
              >
                <option value="">No list</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          {tags.length > 0 && (
            <fieldset className="grid content-start gap-2">
              <legend className="mb-2 text-sm font-medium">Tag every imported contact</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-foreground size-4"
                      checked={options.tagIds.includes(t.id)}
                      onChange={(e) =>
                        change(() =>
                          setOptions({
                            ...options,
                            tagIds: e.target.checked
                              ? [...options.tagIds, t.id]
                              : options.tagIds.filter((x) => x !== t.id),
                          }),
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!preview ? (
        <div>
          <Button onClick={validate} disabled={pending}>
            {pending ? "Checking rows…" : `Check ${rowCount.toLocaleString("en-US")} rows`}
          </Button>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview</CardTitle>
            <CardDescription>Nothing has been imported yet.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="import-summary">
              <Stat label="New contacts" value={preview.newCount} />
              <Stat
                label={options.duplicateStrategy === "update" ? "Existing (will update)" : "Existing (will skip)"}
                value={preview.existingCount}
              />
              <Stat
                label="Rows with errors"
                value={preview.invalidCount}
                tone={preview.invalidCount > 0 ? "destructive" : undefined}
              />
              <Stat label="Total rows" value={preview.totalRows} />
            </dl>
            {preview.keptOptedOutCount > 0 && (
              <Alert>
                <AlertDescription>
                  {preview.keptOptedOutCount.toLocaleString("en-US")} existing contact(s) previously opted out. They
                  will stay opted out even though the file marks them as opted in.
                </AlertDescription>
              </Alert>
            )}
            {preview.sample.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">Row</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="pr-3">Opt-in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.slice(0, 10).map((r) => (
                      <TableRow key={r.rowNumber}>
                        <TableCell className="text-muted-foreground pl-3">{r.rowNumber}</TableCell>
                        <TableCell className="tabular-nums">{r.e164}</TableCell>
                        <TableCell>{[r.firstName, r.lastName].filter(Boolean).join(" ")}</TableCell>
                        <TableCell>{r.email}</TableCell>
                        <TableCell className="pr-3">{r.optInStatus.replace("_", " ").toLowerCase()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {preview.invalidSample.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">Rows that will not be imported</h3>
                <ul className="grid gap-1 text-sm" data-testid="import-errors">
                  {preview.invalidSample.map((r) => (
                    <li key={r.rowNumber}>
                      <span className="text-muted-foreground">Row {r.rowNumber}:</span> {r.errors.join("; ")}
                    </li>
                  ))}
                </ul>
                {preview.invalidCount > preview.invalidSample.length && (
                  <p className="text-muted-foreground text-xs">All failed rows can be downloaded after the import.</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirm(true)} disabled={pending || importCount === 0}>
                Import {importCount.toLocaleString("en-US")} contact{importCount === 1 ? "" : "s"}
              </Button>
              <Button variant="outline" onClick={validate} disabled={pending}>
                Check again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {importCount.toLocaleString("en-US")} contacts?</DialogTitle>
            <DialogDescription>
              {preview?.newCount.toLocaleString("en-US")} will be created
              {options.duplicateStrategy === "update"
                ? ` and ${preview?.existingCount.toLocaleString("en-US")} updated`
                : ""}
              .
              {preview && preview.invalidCount > 0
                ? ` ${preview.invalidCount.toLocaleString("en-US")} rows with errors will be skipped.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={run} disabled={pending}>
              {pending ? "Importing…" : "Start import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "destructive" }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={
          tone === "destructive"
            ? "text-destructive text-lg font-semibold tabular-nums"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}
