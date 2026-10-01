/**
 * WhatsApp message template helpers shared by server and UI. Shapes and limits
 * follow WA/templates/overview and WA/templates/components (see
 * docs/META_API_VERIFICATION.md, Phase 4 section).
 */
import { z } from "zod";
import { TEMPLATE_LANGUAGE_CODES } from "./languages";

export type ParameterFormat = "POSITIONAL" | "NAMED";
export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type TemplateCategoryValue = (typeof TEMPLATE_CATEGORIES)[number];

export interface MetaTemplateButton {
  type: string; // QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE, ...
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}

export interface MetaTemplateComponent {
  type: string; // HEADER, BODY, FOOTER, BUTTONS (Meta returns upper case)
  format?: string; // HEADER only: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
  text?: string;
  buttons?: MetaTemplateButton[];
  example?: Record<string, unknown>;
}

export const LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  url: 2000,
  phone: 20,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
} as const;

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NAMED_PARAM = /^[a-z_]+$/;
const POSITIONAL_PARAM = /^[1-9]\d*$/;

/** Variable names in order of first appearance ("1", "2" or "first_name"). */
export function extractVariables(text: string | undefined | null): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Problems with the variables in one text, or null if fine. */
export function checkVariables(text: string, format: ParameterFormat, label: string): string | null {
  const vars = extractVariables(text);
  if (format === "POSITIONAL") {
    if (vars.some((v) => !POSITIONAL_PARAM.test(v))) {
      return `${label}: use numbered variables like {{1}}, {{2}}.`;
    }
    const numbers = vars.map(Number).sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1)) {
      return `${label}: number variables in order starting at {{1}} with no gaps.`;
    }
  } else if (vars.some((v) => !NAMED_PARAM.test(v))) {
    return `${label}: variable names may only use lowercase letters and underscores, like {{first_name}}.`;
  }
  return null;
}

export const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(LIMITS.name)
  .regex(/^[a-z0-9_]+$/, "Use only lowercase letters, numbers and underscores");

const buttonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(LIMITS.buttonText) }),
  z.object({
    type: z.literal("URL"),
    text: z.string().trim().min(1).max(LIMITS.buttonText),
    url: z.url({ protocol: /^https?$/ }).max(LIMITS.url),
    example: z.string().trim().max(LIMITS.url).optional(),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().trim().min(1).max(LIMITS.buttonText),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+?\d{4,19}$/, "Enter the phone number with country code, digits only"),
  }),
]);
export type TemplateButtonInput = z.infer<typeof buttonSchema>;

/** A template as written in our editor, before conversion to Meta's component format. */
export const templateDraftSchema = z
  .object({
    whatsappAccountId: z.string().min(1, "Choose a WhatsApp number"),
    name: templateNameSchema,
    language: z.string().refine((v) => TEMPLATE_LANGUAGE_CODES.has(v), "Choose a supported language"),
    category: z.enum(TEMPLATE_CATEGORIES),
    parameterFormat: z.enum(["POSITIONAL", "NAMED"]),
    headerText: z.string().trim().max(LIMITS.headerText).optional().default(""),
    body: z.string().trim().min(1, "Enter the message body").max(LIMITS.body),
    footer: z.string().trim().max(LIMITS.footer).optional().default(""),
    buttons: z.array(buttonSchema).max(LIMITS.buttons).default([]),
    // Example value for each variable, keyed by section then variable name.
    examples: z
      .object({
        header: z.record(z.string(), z.string()).default({}),
        body: z.record(z.string(), z.string()).default({}),
      })
      .default({ header: {}, body: {} }),
  })
  .superRefine((t, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (t.category === "AUTHENTICATION") {
      issue("category", "Authentication templates use a fixed format. Create them in WhatsApp Manager.");
    }
    const headerVars = extractVariables(t.headerText);
    if (headerVars.length > 1) issue("headerText", "The header can contain at most one variable.");
    for (const [field, text, label] of [
      ["headerText", t.headerText, "Header"],
      ["body", t.body, "Body"],
    ] as const) {
      const problem = checkVariables(text, t.parameterFormat, label);
      if (problem) issue(field, problem);
    }
    if (t.parameterFormat === "POSITIONAL" && headerVars.length === 1 && headerVars[0] !== "1") {
      issue("headerText", "The header variable must be {{1}}.");
    }
    if (extractVariables(t.footer).length > 0) issue("footer", "The footer cannot contain variables.");
    for (const [section, vars] of [
      ["header", headerVars],
      ["body", extractVariables(t.body)],
    ] as const) {
      for (const v of vars) {
        if (!t.examples[section][v]?.trim()) issue(`examples.${section}.${v}`, `Add an example for {{${v}}}`);
      }
    }
    const urls = t.buttons.filter((b) => b.type === "URL");
    if (urls.length > LIMITS.urlButtons) issue("buttons", "Use at most two website buttons.");
    if (t.buttons.filter((b) => b.type === "PHONE_NUMBER").length > LIMITS.phoneButtons) {
      issue("buttons", "Use at most one call button.");
    }
    for (const b of urls) {
      const vars = extractVariables(b.url);
      if (vars.length > 1) issue("buttons", "A website button supports one variable.");
      if (vars.length === 1) {
        if (!/\{\{[^{}]+\}\}$/.test(b.url)) issue("buttons", "The website variable must be at the end of the URL.");
        if (!b.example?.trim()) issue("buttons", `Add an example value for the "${b.text}" website variable.`);
      }
    }
  });
export type TemplateDraft = z.infer<typeof templateDraftSchema>;

function exampleFor(
  section: "header" | "body",
  format: ParameterFormat,
  text: string,
  examples: Record<string, string>,
) {
  const vars = extractVariables(text);
  if (vars.length === 0) return undefined;
  if (format === "NAMED") {
    const key = section === "header" ? "header_text_named_params" : "body_text_named_params";
    return { [key]: vars.map((v) => ({ param_name: v, example: examples[v] ?? "" })) };
  }
  const ordered = [...vars].sort((a, b) => Number(a) - Number(b)).map((v) => examples[v] ?? "");
  return section === "header" ? { header_text: ordered } : { body_text: [ordered] };
}

/** Converts an editor draft into Meta's creation `components` array. */
export function buildComponents(draft: TemplateDraft): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];
  if (draft.headerText) {
    const example = exampleFor("header", draft.parameterFormat, draft.headerText, draft.examples.header);
    components.push({ type: "HEADER", format: "TEXT", text: draft.headerText, ...(example ? { example } : {}) });
  }
  const bodyExample = exampleFor("body", draft.parameterFormat, draft.body, draft.examples.body);
  components.push({ type: "BODY", text: draft.body, ...(bodyExample ? { example: bodyExample } : {}) });
  if (draft.footer) components.push({ type: "FOOTER", text: draft.footer });
  if (draft.buttons.length > 0) {
    // Meta requires quick replies and other buttons to be grouped, not interleaved.
    const ordered = [
      ...draft.buttons.filter((b) => b.type === "QUICK_REPLY"),
      ...draft.buttons.filter((b) => b.type !== "QUICK_REPLY"),
    ];
    components.push({
      type: "BUTTONS",
      buttons: ordered.map((b): MetaTemplateButton => {
        if (b.type === "URL") {
          const hasVar = extractVariables(b.url).length === 1;
          return { type: "URL", text: b.text, url: b.url, ...(hasVar && b.example ? { example: [b.example] } : {}) };
        }
        if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }
  return components;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Values used to fill a template: variable name -> value per section, URL button index -> value. */
export interface TemplateValues {
  header?: Record<string, string>;
  body?: Record<string, string>;
  buttons?: Record<string, string>;
}

export interface TemplateRequirements {
  header: string[];
  body: string[];
  /** Index (in Meta's button array) of each URL button that takes a variable. */
  buttons: number[];
  /** IMAGE, VIDEO or DOCUMENT when the header needs a file at send time. */
  headerMedia: "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  /** True when the template uses a component this app cannot fill (e.g. location header, copy code). */
  unsupported: string | null;
}

function component(components: MetaTemplateComponent[], type: string) {
  return components.find((c) => c.type.toUpperCase() === type);
}

/** What has to be supplied to send a template. */
export function templateRequirements(components: MetaTemplateComponent[]): TemplateRequirements {
  const header = component(components, "HEADER");
  const format = header?.format?.toUpperCase() ?? null;
  const buttons = component(components, "BUTTONS")?.buttons ?? [];
  let unsupported: string | null = null;
  if (format && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(format))
    unsupported = `${format.toLowerCase()} header`;
  const known = new Set(["QUICK_REPLY", "URL", "PHONE_NUMBER"]);
  const odd = buttons.find((b) => !known.has(b.type.toUpperCase()));
  if (odd) unsupported = `${odd.type.toLowerCase().replace(/_/g, " ")} button`;
  for (const c of components) {
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(c.type.toUpperCase())) {
      unsupported = `${c.type.toLowerCase()} component`;
    }
  }
  return {
    header: format === "TEXT" ? extractVariables(header?.text) : [],
    body: extractVariables(component(components, "BODY")?.text),
    buttons: buttons.flatMap((b, i) =>
      b.type.toUpperCase() === "URL" && extractVariables(b.url).length > 0 ? [i] : [],
    ),
    headerMedia: format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT" ? format : null,
    unsupported,
  };
}

/** Names of required values that are missing or blank, as user-facing labels. */
export function missingValues(req: TemplateRequirements, values: TemplateValues): string[] {
  const missing: string[] = [];
  for (const v of req.header) if (!values.header?.[v]?.trim()) missing.push(`header {{${v}}}`);
  for (const v of req.body) if (!values.body?.[v]?.trim()) missing.push(`{{${v}}}`);
  for (const i of req.buttons) if (!values.buttons?.[String(i)]?.trim()) missing.push(`button ${i + 1} link value`);
  return missing;
}

function fill(text: string | undefined, values: Record<string, string> | undefined) {
  if (!text) return "";
  return text.replace(PLACEHOLDER, (whole, name: string) => values?.[name] ?? whole);
}

/** Plain-text rendering used for the inbox history and previews. */
export function renderTemplate(components: MetaTemplateComponent[], values: TemplateValues = {}) {
  const header = component(components, "HEADER");
  const headerText = header?.format?.toUpperCase() === "TEXT" ? fill(header.text, values.header) : "";
  const body = fill(component(components, "BODY")?.text, values.body);
  const footer = component(components, "FOOTER")?.text ?? "";
  const buttons = (component(components, "BUTTONS")?.buttons ?? []).map((b) => b.text ?? b.type);
  const headerMedia = header && header.format?.toUpperCase() !== "TEXT" ? (header.format ?? null) : null;
  return { header: headerText, headerMedia, body, footer, buttons };
}

/** Single string for message history. */
export function renderTemplateText(components: MetaTemplateComponent[], values: TemplateValues = {}) {
  const r = renderTemplate(components, values);
  return [r.header, r.body, r.footer].filter(Boolean).join("\n\n");
}

export interface SendComponent {
  type: "header" | "body" | "button";
  sub_type?: "url";
  index?: string;
  parameters: Record<string, unknown>[];
}

/**
 * Builds the `components` of a template send request (WA/templates/overview,
 * WA/templates/components). URL button values are percent-encoded as Meta requires.
 */
export function buildSendComponents(
  components: MetaTemplateComponent[],
  format: ParameterFormat,
  values: TemplateValues,
  headerMediaId?: string | null,
): SendComponent[] {
  const req = templateRequirements(components);
  const out: SendComponent[] = [];
  const textParam = (name: string, value: string) =>
    format === "NAMED" ? { type: "text", parameter_name: name, text: value } : { type: "text", text: value };
  const order = (vars: string[]) => (format === "NAMED" ? vars : [...vars].sort((a, b) => Number(a) - Number(b)));

  if (req.headerMedia && headerMediaId) {
    const kind = req.headerMedia.toLowerCase();
    out.push({ type: "header", parameters: [{ type: kind, [kind]: { id: headerMediaId } }] });
  } else if (req.header.length > 0) {
    out.push({ type: "header", parameters: order(req.header).map((v) => textParam(v, values.header?.[v] ?? "")) });
  }
  if (req.body.length > 0) {
    out.push({ type: "body", parameters: order(req.body).map((v) => textParam(v, values.body?.[v] ?? "")) });
  }
  const buttons = component(components, "BUTTONS")?.buttons ?? [];
  for (const i of req.buttons) {
    const name = extractVariables(buttons[i]?.url)[0] ?? "1";
    const value = encodeURIComponent(values.buttons?.[String(i)] ?? "");
    out.push({ type: "button", sub_type: "url", index: String(i), parameters: [textParam(name, value)] });
  }
  return out;
}

/** Statuses in which a template may be sent. */
export function isSendable(status: string) {
  return status === "APPROVED";
}

export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAUSED: "Paused",
  DISABLED: "Disabled",
  FLAGGED: "Flagged",
  IN_APPEAL: "In appeal",
  ARCHIVED: "Archived",
  LIMIT_EXCEEDED: "Limit exceeded",
  LOCKED: "Locked",
  PENDING_DELETION: "Being deleted",
  DELETED: "Deleted",
  UNKNOWN: "Unknown",
};

const META_STATUSES = new Set(Object.keys(TEMPLATE_STATUS_LABELS));

/**
 * Maps Meta's status string (API or webhook event) onto our enum. REINSTATED means sendable again.
 * UNARCHIVED restores the previous status, which the webhook does not include, so it maps to
 * UNKNOWN and the caller re-reads the template from Meta.
 */
export function mapMetaTemplateStatus(value: unknown): string {
  const s = String(value ?? "").toUpperCase();
  if (s === "REINSTATED") return "APPROVED";
  if (s === "IN_REVIEW") return "PENDING";
  return META_STATUSES.has(s) && s !== "DRAFT" ? s : "UNKNOWN";
}
