"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TemplatePreview } from "@/components/app/template-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { missingValues, templateRequirements, type MetaTemplateComponent, type TemplateValues } from "@/lib/templates";

export interface ComposerTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  components: MetaTemplateComponent[];
}

const ACCEPT: Record<string, string> = {
  IMAGE: "image/jpeg,image/png",
  VIDEO: "video/mp4,video/3gpp",
  DOCUMENT: "application/pdf",
};

/**
 * Pick an approved template, fill its variables and send. `submit` receives
 * FormData with templateId, values (JSON), headerFile and idempotencyKey.
 */
export function TemplateComposer({
  templates,
  submit,
  defaults = {},
  disabledReason,
  extraFields,
}: {
  templates: ComposerTemplate[];
  submit: (formData: FormData) => Promise<{ ok: boolean; message?: string } | void>;
  /** Suggested values, e.g. the contact's first name. */
  defaults?: Record<string, string>;
  disabledReason?: string | null;
  extraFields?: React.ReactNode;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  // Variables whose name matches a known value (e.g. {{first_name}} or {{1}}) start pre-filled.
  const prefill = (id: string): TemplateValues => {
    const t = templates.find((x) => x.id === id);
    if (!t) return {};
    const r = templateRequirements(t.components);
    const pick = (names: string[]) =>
      Object.fromEntries(names.filter((n) => defaults[n]).map((n) => [n, defaults[n]!]));
    return { header: pick(r.header), body: pick(r.body) };
  };
  const [values, setValues] = useState<TemplateValues>(() => prefill(templates[0]?.id ?? ""));
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const template = templates.find((t) => t.id === templateId);

  if (templates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No approved templates for this number yet. Create one under Templates, or sync from WhatsApp Manager.
      </p>
    );
  }

  const req = template ? templateRequirements(template.components) : null;
  const missing = req ? missingValues(req, values) : [];
  const needsFile = !!req?.headerMedia && !file;

  const set = (section: keyof TemplateValues, name: string, value: string) =>
    setValues((v) => ({ ...v, [section]: { ...(v[section] ?? {}), [name]: value } }));

  const fields: { section: keyof TemplateValues; name: string; label: string }[] = req
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

  return (
    <form
      className="grid gap-4 lg:grid-cols-[1fr_300px]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const fd = new FormData(e.currentTarget);
          fd.set("templateId", templateId);
          fd.set("values", JSON.stringify(values));
          fd.set("idempotencyKey", key);
          if (file) fd.set("headerFile", file);
          const r = await submit(fd);
          if (r && !r.ok) {
            toast.error(r.message ?? "Sending failed.");
            return;
          }
          toast.success("Template queued for sending.");
          setValues(prefill(templateId));
          setFile(null);
          setKey(crypto.randomUUID());
        });
      }}
    >
      <div className="grid content-start gap-3">
        {extraFields}
        <div className="grid gap-2">
          <Label htmlFor="template">Template</Label>
          <NativeSelect
            id="template"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setValues(prefill(e.target.value));
              setFile(null);
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language}, {t.category.toLowerCase()})
              </option>
            ))}
          </NativeSelect>
        </div>
        {req?.unsupported && (
          <p className="text-destructive text-sm">
            This template uses a {req.unsupported}, which cannot be sent from here.
          </p>
        )}
        {req?.headerMedia && (
          <div className="grid gap-2">
            <Label htmlFor="header-file">Header {req.headerMedia.toLowerCase()}</Label>
            <Input
              id="header-file"
              type="file"
              accept={ACCEPT[req.headerMedia]}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
        {fields.map((f) => {
          const id = `tv-${f.section}-${f.name}`;
          return (
            <div key={id} className="grid gap-2">
              <Label htmlFor={id}>{f.label}</Label>
              <Input
                id={id}
                value={values[f.section]?.[f.name] ?? ""}
                onChange={(e) => set(f.section, f.name, e.target.value)}
              />
            </div>
          );
        })}
        {disabledReason && <p className="text-destructive text-sm">{disabledReason}</p>}
        <div>
          <Button
            type="submit"
            disabled={pending || !template || missing.length > 0 || needsFile || !!req?.unsupported || !!disabledReason}
          >
            {pending ? "Sending…" : "Send template"}
          </Button>
        </div>
      </div>
      {template && <TemplatePreview components={template.components} values={values} className="self-start" />}
    </form>
  );
}
