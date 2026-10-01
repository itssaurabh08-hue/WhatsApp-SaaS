import { z } from "zod";
import { CUSTOM_FIELD_KEY_PATTERN, TAG_COLORS } from "@/lib/contacts/fields";
import { isCountryCode } from "@/lib/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const optInStatusSchema = z.enum(["UNKNOWN", "OPTED_IN", "OPTED_OUT"]);

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || isCountryCode(v), "Choose a valid country.")
  .transform((v) => (v === "" ? null : v));

export const contactInputSchema = z.object({
  phoneNumber: z.string().trim().min(1, "Enter a phone number.").max(40),
  firstName: optionalText(100),
  lastName: optionalText(100),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  company: optionalText(120),
  country: countryCodeSchema,
  optInStatus: optInStatusSchema,
  optInSource: optionalText(120),
  customFields: z.record(z.string(), z.string().max(500)).default({}),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export const tagInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a tag name.").max(50),
  color: z.enum(TAG_COLORS).default("gray"),
});

export const listInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a list name.").max(80),
  description: optionalText(300),
});

export const customFieldInputSchema = z.object({
  label: z.string().trim().min(1, "Enter a label.").max(60),
  key: z
    .string()
    .trim()
    .regex(CUSTOM_FIELD_KEY_PATTERN, "Use lowercase letters, numbers and underscores, starting with a letter."),
  type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]),
});

export const noteInputSchema = z.object({ body: z.string().trim().min(1, "Write a note.").max(5000) });

/** Filters accepted by the contacts list, export and bulk "all matching" actions. */
export const contactFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  tagId: z.string().max(64).optional(),
  listId: z.string().max(64).optional(),
  segmentId: z.string().max(64).optional(),
  optInStatus: optInStatusSchema.optional(),
});

export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const CONTACT_SORTS = ["newest", "oldest", "name"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];
