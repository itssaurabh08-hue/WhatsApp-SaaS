"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form-field";
import type { ComposerTemplate } from "@/components/app/template-composer";
import { TemplatePreview } from "@/components/app/template-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { STANDARD_FIELDS, type VariableMapping, type VariableSource } from "@/lib/campaigns";
import { templateRequirements } from "@/lib/templates";
import { createCampaignAction, estimateAction } from "../actions";

type AudienceType = "all" | "list" | "tag" | "segment";
type Section = "header" | "body" | "buttons";

export function CampaignForm({
  slug,
  accounts,
  templatesByAccount,
  audiences,
  customFields,
}: {
  slug: string;
  accounts: { id: string; label: string }[];
  templatesByAccount: Record<string, ComposerTemplate[]>;
  audiences: Record<"list" | "tag" | "segment", { id: string; name: string }[]>;
  customFields: { key: string; label: string }[];
}) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]!.id);
  const templates = templatesByAccount[accountId] ?? [];
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [audienceType, setAudienceType] = useState<AudienceType>("list");
  const [audienceId, setAudienceId] = useState("");
  const [mapping, setMapping] = useState<VariableMapping>({ header: {}, body: {}, buttons: {} });
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [estimate, setEstimate] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const template = templates.find((t) => t.id === templateId);
  const req = template ? templateRequirements(template.components) : null;
  const marketing = template?.category === "MARKETING";
  const fieldOptions = [...STANDARD_FIELDS, ...customFields];
  const audience = audienceType === "all" ? { type: "all" } : { type: audienceType, id: audienceId };

  const variables: { section: Section; name: string; label: string }[] = req
    ? [
        ...req.header.map((n) => ({ section: "header" as const, name: n, label: `Header {{${n}}}` })),
        ...req.body.map((n) => ({ section: "body" as const, name: n, label: `{{${n}}}` })),
        ...req.buttons.map((i) => ({
          section: "buttons" as const,
          name: String(i),
          label: `Button ${i + 1} link value`,
        })),
      ]
    : [];
  const sourceOf = (s: Section, n: string): VariableSource =>
    mapping[s][n] ?? { source: "field", field: "firstName", fallback: "" };
  const setSource = (s: Section, n: string, src: VariableSource) =>
    setMapping((m) => ({ ...m, [s]: { ...m[s], [n]: src } }));

  const formData = () => {
    const fd = new FormData();
    const full: VariableMapping = { header: {}, body: {}, buttons: {} };
    for (const v of variables) full[v.section][v.name] = sourceOf(v.section, v.name);
    fd.set("name", name);
    fd.set("whatsappAccountId", accountId);
    fd.set("templateId", templateId);
    fd.set("audience", JSON.stringify(audience));
    fd.set("mapping", JSON.stringify(full));
    fd.set("includeUnknownOptIn", String(marketing && includeUnknown));
    if (file) fd.set("headerFile", file);
    return fd;
  };

  // Preview with each variable shown as its source.
  const previewValues = { header: {}, body: {}, buttons: {} } as Record<Section, Record<string, string>>;
  for (const v of variables) {
    const src = sourceOf(v.section, v.name);
    previewValues[v.section][v.name] =
      src.source === "static"
        ? src.value || "…"
        : `[${fieldOptions.find((f) => f.key === src.field)?.label ?? src.field}]`;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <FormField id="name" label="Campaign name">
          <Input id="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {accounts.length > 1 && (
          <FormField id="account" label="Send from">
            <NativeSelect
              id="account"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setTemplateId(templatesByAccount[e.target.value]?.[0]?.id ?? "");
                setMapping({ header: {}, body: {}, buttons: {} });
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField
          id="template"
          label="Template"
          hint={templates.length === 0 ? "No approved templates for this number yet." : undefined}
        >
          <NativeSelect
            id="template"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setMapping({ header: {}, body: {}, buttons: {} });
              setFile(null);
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language}, {t.category.toLowerCase()})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {req?.unsupported && (
          <p className="text-destructive text-sm">
            This template uses a {req.unsupported}, which campaigns cannot send.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="audience-type" label="Send to">
            <NativeSelect
              id="audience-type"
              value={audienceType}
              onChange={(e) => {
                setAudienceType(e.target.value as AudienceType);
                setAudienceId("");
                setEstimate(null);
              }}
            >
              <option value="list">A contact list</option>
              <option value="tag">Contacts with a tag</option>
              <option value="segment">A segment</option>
              <option value="all">All contacts</option>
            </NativeSelect>
          </FormField>
          {audienceType !== "all" && (
            <FormField
              id="audience"
              label={audienceType === "list" ? "List" : audienceType === "tag" ? "Tag" : "Segment"}
            >
              <NativeSelect
                id="audience"
                value={audienceId}
                onChange={(e) => {
                  setAudienceId(e.target.value);
                  setEstimate(null);
                }}
              >
                <option value="">Choose…</option>
                {audiences[audienceType].map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
        </div>

        {marketing && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeUnknown}
              onChange={(e) => setIncludeUnknown(e.target.checked)}
            />
            <span>
              Also send to contacts whose opt-in is unknown.{" "}
              <span className="text-muted-foreground">
                Only do this if they agreed to receive marketing from you. Opted-out contacts never receive campaigns.
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending || (audienceType !== "all" && !audienceId)}
            onClick={() =>
              start(async () => {
                const r = await estimateAction(slug, formData());
                if (!r.ok || !("eligible" in r)) return void toast.error(r.message ?? "Could not count the audience.");
                const excluded = [
                  r.optedOut ? `${r.optedOut.toLocaleString("en-US")} opted out` : "",
                  r.unknownExcluded ? `${r.unknownExcluded.toLocaleString("en-US")} without marketing opt-in` : "",
                ].filter(Boolean);
                setEstimate(
                  `${r.eligible.toLocaleString("en-US")} of ${r.total.toLocaleString("en-US")} contacts will receive it` +
                    (excluded.length ? ` (excluded: ${excluded.join(", ")}).` : "."),
                );
              })
            }
          >
            Count recipients
          </Button>
          {estimate && <p className="text-sm">{estimate}</p>}
        </div>

        {(variables.length > 0 || req?.headerMedia) && (
          <fieldset className="grid gap-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Template values</legend>
            {req?.headerMedia && (
              <FormField id="header-file" label={`Header ${req.headerMedia.toLowerCase()}`}>
                <Input id="header-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </FormField>
            )}
            {variables.map((v) => {
              const src = sourceOf(v.section, v.name);
              const id = `var-${v.section}-${v.name}`;
              return (
                <div key={id} className="grid gap-2 sm:grid-cols-[120px_1fr_1fr] sm:items-center">
                  <label htmlFor={id} className="text-sm font-medium">
                    {v.label}
                  </label>
                  <NativeSelect
                    id={id}
                    value={src.source === "static" ? "__static" : src.field}
                    onChange={(e) =>
                      setSource(
                        v.section,
                        v.name,
                        e.target.value === "__static"
                          ? { source: "static", value: "" }
                          : {
                              source: "field",
                              field: e.target.value,
                              fallback: src.source === "field" ? src.fallback : "",
                            },
                      )
                    }
                  >
                    {fieldOptions.map((f) => (
                      <option key={f.key} value={f.key}>
                        Contact: {f.label}
                      </option>
                    ))}
                    <option value="__static">Same text for everyone</option>
                  </NativeSelect>
                  {src.source === "static" ? (
                    <Input
                      aria-label={`${v.label} text`}
                      placeholder="Text"
                      value={src.value}
                      onChange={(e) => setSource(v.section, v.name, { source: "static", value: e.target.value })}
                    />
                  ) : (
                    <Input
                      aria-label={`${v.label} fallback`}
                      placeholder="If empty, use… (optional)"
                      value={src.fallback}
                      onChange={(e) => setSource(v.section, v.name, { ...src, fallback: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
            <p className="text-muted-foreground text-xs">Contacts with an empty value and no fallback are skipped.</p>
          </fieldset>
        )}

        <div>
          <Button
            disabled={
              pending || !template || !name.trim() || (audienceType !== "all" && !audienceId) || !!req?.unsupported
            }
            onClick={() =>
              start(async () => {
                const r = await createCampaignAction(slug, formData());
                if (r && !r.ok) toast.error(r.message ?? "Could not save the campaign.");
              })
            }
          >
            Save and review
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Nothing is sent yet. You launch or schedule it on the next screen.
          </p>
        </div>
      </div>
      {template && (
        <aside className="grid content-start gap-2">
          <h2 className="text-sm font-medium">Preview</h2>
          <TemplatePreview components={template.components} values={previewValues} />
        </aside>
      )}
    </div>
  );
}
