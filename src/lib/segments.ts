import { z } from "zod";

/**
 * Segment definition: a flat list of conditions combined with ALL (AND) or
 * ANY (OR). Kept deliberately simple for V1; nested groups can be added later
 * without breaking stored definitions (add a new `version`).
 */
export const TEXT_OPS = ["equals", "not_equals", "contains", "is_empty", "is_not_empty"] as const;
export const DATE_OPS = ["before", "after", "in_last_days"] as const;
export const STANDARD_TEXT_FIELDS = ["firstName", "lastName", "email", "company", "country", "phoneNumber"] as const;

const id = z.string().min(1).max(64);
const textValue = z.string().trim().max(200).optional();

const textCondition = <F extends string>(field: F) =>
  z
    .object({ field: z.literal(field), op: z.enum(TEXT_OPS), value: textValue })
    .refine((c) => c.op === "is_empty" || c.op === "is_not_empty" || (c.value ?? "").length > 0, {
      message: "Enter a value.",
      path: ["value"],
    });

const dateValueRefine = (c: { op: string; value: string }) =>
  c.op === "in_last_days" ? /^\d{1,4}$/.test(c.value) && Number(c.value) > 0 : !Number.isNaN(Date.parse(c.value));

export const segmentConditionSchema = z.union([
  z.object({ field: z.literal("tag"), op: z.enum(["has", "not_has"]), value: id }),
  z.object({ field: z.literal("list"), op: z.enum(["in", "not_in"]), value: id }),
  z.object({
    field: z.literal("optInStatus"),
    op: z.enum(["is", "is_not"]),
    value: z.enum(["UNKNOWN", "OPTED_IN", "OPTED_OUT"]),
  }),
  ...STANDARD_TEXT_FIELDS.map((f) => textCondition(f)),
  z
    .object({ field: z.literal("custom"), key: z.string().min(1).max(40), op: z.enum(TEXT_OPS), value: textValue })
    .refine((c) => c.op === "is_empty" || c.op === "is_not_empty" || (c.value ?? "").length > 0, {
      message: "Enter a value.",
      path: ["value"],
    }),
  z
    .object({ field: z.literal("createdAt"), op: z.enum(DATE_OPS), value: z.string().max(40) })
    .refine(dateValueRefine, { message: "Enter a valid date or number of days.", path: ["value"] }),
  z
    .object({
      field: z.literal("lastMessageAt"),
      op: z.enum([...DATE_OPS, "never"]),
      value: z.string().max(40).default(""),
    })
    .refine((c) => c.op === "never" || dateValueRefine(c), {
      message: "Enter a valid date or number of days.",
      path: ["value"],
    }),
]);

export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export const segmentDefinitionSchema = z.object({
  version: z.literal(1).default(1),
  match: z.enum(["all", "any"]),
  conditions: z
    .array(segmentConditionSchema)
    .min(1, "Add at least one condition.")
    .max(20, "Use at most 20 conditions."),
});

export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

export const CONDITION_FIELD_LABELS: Record<SegmentCondition["field"], string> = {
  tag: "Tag",
  list: "List",
  optInStatus: "Opt-in status",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  company: "Company",
  country: "Country code",
  phoneNumber: "Phone number",
  custom: "Custom field",
  createdAt: "Date added",
  lastMessageAt: "Last message date",
};

export const OP_LABELS: Record<string, string> = {
  has: "has",
  not_has: "does not have",
  in: "is in",
  not_in: "is not in",
  is: "is",
  is_not: "is not",
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  before: "is before",
  after: "is after",
  in_last_days: "is in the last (days)",
  never: "never",
};
