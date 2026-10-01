"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useActionState, useState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { TemplatePreview } from "@/components/app/template-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_LANGUAGES } from "@/lib/templates/languages";
import {
  buildComponents,
  extractVariables,
  LIMITS,
  type TemplateButtonInput,
  type TemplateDraft,
} from "@/lib/templates";
import { createTemplateAction, type TemplateFormState } from "../actions";

type Button_ = TemplateButtonInput;

export function TemplateEditor({ slug, accounts }: { slug: string; accounts: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<TemplateFormState, FormData>(createTemplateAction.bind(null, slug), {});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("UTILITY");
  const [parameterFormat, setFormat] = useState<"POSITIONAL" | "NAMED">("POSITIONAL");
  const [headerText, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<Button_[]>([]);
  const [examples, setExamples] = useState<{ header: Record<string, string>; body: Record<string, string> }>({
    header: {},
    body: {},
  });
  const errors = state.errors ?? {};

  const headerVars = extractVariables(headerText);
  const bodyVars = extractVariables(body);
  const draft: TemplateDraft = {
    whatsappAccountId: accountId,
    name,
    language,
    category,
    parameterFormat,
    headerText,
    body,
    footer,
    buttons,
    examples,
  };
  const previewComponents = buildComponents(draft);
  const previewValues = { header: examples.header, body: examples.body };

  const addVariable = () => {
    const next =
      parameterFormat === "POSITIONAL" ? String(bodyVars.filter((v) => /^\d+$/.test(v)).length + 1) : "variable_name";
    setBody((b) => `${b}{{${next}}}`);
  };
  const setButton = (i: number, patch: Partial<Button_>) =>
    setButtons((list) => list.map((b, j) => (j === i ? ({ ...b, ...patch } as Button_) : b)));

  return (
    <form action={formAction} className="grid gap-8 lg:grid-cols-[1fr_380px]" noValidate>
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      <div className="grid content-start gap-5">
        {state.message && !state.ok && (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="name"
            label="Template name"
            error={errors.name}
            hint="Lowercase letters, numbers and underscores, e.g. order_update"
          >
            <Input
              id="name"
              value={name}
              maxLength={LIMITS.name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s-]+/g, "_"))}
              aria-invalid={!!errors.name}
            />
          </FormField>
          {accounts.length > 1 && (
            <FormField id="account" label="WhatsApp number" error={errors.whatsappAccountId}>
              <NativeSelect id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField
            id="category"
            label="Category"
            error={errors.category}
            hint={
              category === "MARKETING"
                ? "Promotions, offers, newsletters. Never sent to opted-out contacts."
                : "Updates about an existing order, account or request. Meta may recategorize promotional content."
            }
          >
            <NativeSelect
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")}
            >
              <option value="UTILITY">Utility</option>
              <option value="MARKETING">Marketing</option>
            </NativeSelect>
          </FormField>
          <FormField id="language" label="Language" error={errors.language}>
            <NativeSelect id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {TEMPLATE_LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({code})
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="format" label="Variable style" hint="How placeholders are written in the text.">
            <NativeSelect
              id="format"
              value={parameterFormat}
              onChange={(e) => setFormat(e.target.value as "POSITIONAL" | "NAMED")}
            >
              <option value="POSITIONAL">Numbered: {"{{1}}, {{2}}"}</option>
              <option value="NAMED">Named: {"{{first_name}}"}</option>
            </NativeSelect>
          </FormField>
        </div>

        <FormField
          id="header"
          label="Header (optional)"
          error={errors.headerText}
          hint={`Up to ${LIMITS.headerText} characters and one variable. Image or video headers can be added in WhatsApp Manager.`}
        >
          <Input
            id="header"
            value={headerText}
            maxLength={LIMITS.headerText}
            onChange={(e) => setHeader(e.target.value)}
          />
        </FormField>

        <FormField
          id="body"
          label="Message body"
          error={errors.body}
          hint={`${body.length}/${LIMITS.body} characters. Use *bold* and _italic_ like in WhatsApp.`}
        >
          <Textarea
            id="body"
            rows={6}
            value={body}
            maxLength={LIMITS.body}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={!!errors.body}
          />
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addVariable}>
              <PlusIcon />
              Add variable
            </Button>
          </div>
        </FormField>

        {(headerVars.length > 0 || bodyVars.length > 0) && (
          <fieldset className="grid gap-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Example values</legend>
            <p className="text-muted-foreground text-sm">
              Meta requires a realistic example for every variable to review the template.
            </p>
            {(["header", "body"] as const).flatMap((section) =>
              (section === "header" ? headerVars : bodyVars).map((v) => {
                const id = `ex-${section}-${v}`;
                return (
                  <FormField
                    key={id}
                    id={id}
                    label={`${section === "header" ? "Header " : ""}{{${v}}}`}
                    error={errors[`examples.${section}.${v}`]}
                  >
                    <Input
                      id={id}
                      value={examples[section][v] ?? ""}
                      onChange={(e) =>
                        setExamples((ex) => ({ ...ex, [section]: { ...ex[section], [v]: e.target.value } }))
                      }
                    />
                  </FormField>
                );
              }),
            )}
          </fieldset>
        )}

        <FormField
          id="footer"
          label="Footer (optional)"
          error={errors.footer}
          hint={`Up to ${LIMITS.footer} characters, no variables.`}
        >
          <Input id="footer" value={footer} maxLength={LIMITS.footer} onChange={(e) => setFooter(e.target.value)} />
        </FormField>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Buttons (optional)</h2>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={buttons.length >= LIMITS.buttons}
                onClick={() => setButtons((b) => [...b, { type: "QUICK_REPLY", text: "" }])}
              >
                Quick reply
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={buttons.length >= LIMITS.buttons}
                onClick={() => setButtons((b) => [...b, { type: "URL", text: "", url: "https://" }])}
              >
                Website
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={buttons.length >= LIMITS.buttons}
                onClick={() => setButtons((b) => [...b, { type: "PHONE_NUMBER", text: "", phoneNumber: "" }])}
              >
                Call
              </Button>
            </div>
          </div>
          {errors.buttons && <p className="text-destructive text-sm">{errors.buttons}</p>}
          {buttons.map((b, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                aria-label={`Button ${i + 1} label`}
                placeholder="Button label"
                value={b.text}
                maxLength={LIMITS.buttonText}
                onChange={(e) => setButton(i, { text: e.target.value })}
              />
              {b.type === "URL" && (
                <div className="grid gap-2">
                  <Input
                    aria-label={`Button ${i + 1} URL`}
                    placeholder="https://example.com/{{1}}"
                    value={b.url}
                    onChange={(e) => setButton(i, { url: e.target.value })}
                  />
                  {extractVariables(b.url).length > 0 && (
                    <Input
                      aria-label={`Button ${i + 1} example`}
                      placeholder="Example value for the URL variable"
                      value={b.example ?? ""}
                      onChange={(e) => setButton(i, { example: e.target.value })}
                    />
                  )}
                </div>
              )}
              {b.type === "PHONE_NUMBER" && (
                <Input
                  aria-label={`Button ${i + 1} phone number`}
                  placeholder="+15551234567"
                  value={b.phoneNumber}
                  onChange={(e) => setButton(i, { phoneNumber: e.target.value })}
                />
              )}
              {b.type === "QUICK_REPLY" && <p className="text-muted-foreground self-center text-sm">Quick reply</p>}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove button ${i + 1}`}
                onClick={() => setButtons((list) => list.filter((_, j) => j !== i))}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
        </div>
      </div>
      <aside className="grid content-start gap-2 lg:sticky lg:top-20">
        <h2 className="text-sm font-medium">Preview</h2>
        <TemplatePreview components={previewComponents} values={previewValues} />
        <p className="text-muted-foreground text-xs">Shown with your example values.</p>
      </aside>
    </form>
  );
}
