import { z } from "zod";

/** Who receives a campaign. Resolved to a fixed recipient list when the campaign starts. */
export const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("list"), id: z.string().min(1) }),
  z.object({ type: z.literal("tag"), id: z.string().min(1) }),
  z.object({ type: z.literal("segment"), id: z.string().min(1) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

/** Where each template variable gets its value. */
export const variableSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("field"),
    field: z.string().min(1).max(100),
    fallback: z.string().max(1024).optional().default(""),
  }),
  z.object({ source: z.literal("static"), value: z.string().max(1024) }),
]);
export type VariableSource = z.infer<typeof variableSourceSchema>;

export const variableMappingSchema = z
  .object({
    header: z.record(z.string(), variableSourceSchema).default({}),
    body: z.record(z.string(), variableSourceSchema).default({}),
    buttons: z.record(z.string(), variableSourceSchema).default({}),
  })
  .default({ header: {}, body: {}, buttons: {} });
export type VariableMapping = z.infer<typeof variableMappingSchema>;

export const STANDARD_FIELDS: { key: string; label: string }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name" },
  { key: "phoneNumber", label: "Phone number" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "country", label: "Country" },
];

export interface MappableContact {
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string;
  email: string | null;
  company: string | null;
  country: string | null;
  customFields: unknown;
}

function fieldValue(contact: MappableContact, field: string): string {
  if (field.startsWith("custom.")) {
    const custom = (contact.customFields ?? {}) as Record<string, unknown>;
    const v = custom[field.slice(7)];
    return v === null || v === undefined ? "" : String(v);
  }
  switch (field) {
    case "fullName":
      return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    case "firstName":
    case "lastName":
    case "phoneNumber":
    case "email":
    case "company":
    case "country":
      return contact[field] ?? "";
    default:
      return "";
  }
}

export function resolveSource(contact: MappableContact, src: VariableSource): string {
  if (src.source === "static") return src.value.trim();
  return fieldValue(contact, src.field).trim() || (src.fallback ?? "").trim();
}

/** Values per section for one contact; `missing` lists variables that resolved to empty. */
export function resolveValues(
  contact: MappableContact,
  mapping: VariableMapping,
  required: { header: string[]; body: string[]; buttons: number[] },
) {
  const values = { header: {} as Record<string, string>, body: {} as Record<string, string>, buttons: {} as Record<string, string> };
  const missing: string[] = [];
  const fill = (section: "header" | "body" | "buttons", names: string[]) => {
    for (const name of names) {
      const src = mapping[section][name];
      const value = src ? resolveSource(contact, src) : "";
      if (!value) missing.push(section === "buttons" ? `button ${Number(name) + 1}` : `{{${name}}}`);
      else values[section][name] = value.slice(0, 1024);
    }
  };
  fill("header", required.header);
  fill("body", required.body);
  fill("buttons", required.buttons.map(String));
  return { values, missing };
}

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Hours after a campaign message during which a customer message counts as a reply to it. */
export const REPLY_ATTRIBUTION_HOURS = 72;

/**
 * Converts a wall-clock time ("2026-10-02T09:30" from <input type="datetime-local">)
 * in an IANA time zone to a UTC Date. Iterates to handle DST offsets.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += target - shown;
  }
  return new Date(guess);
}
