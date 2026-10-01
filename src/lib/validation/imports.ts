import { z } from "zod";
import { STANDARD_FIELDS } from "@/lib/contacts/fields";
import { countryCodeSchema, optInStatusSchema } from "@/lib/validation/contacts";

const standardKeys = STANDARD_FIELDS.map((f) => f.key) as [string, ...string[]];

export const columnTargetSchema = z.union([
  z.literal(""),
  z.enum(standardKeys),
  z.string().regex(/^custom:[a-z][a-z0-9_]{0,39}$/),
]);

export const importOptionsSchema = z.object({
  defaultCountry: countryCodeSchema,
  defaultOptInStatus: optInStatusSchema,
  optInSource: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === "" ? null : v)),
  duplicateStrategy: z.enum(["skip", "update"]),
  tagIds: z.array(z.string().max(64)).max(20).default([]),
  listId: z
    .string()
    .max(64)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const importMappingSchema = z
  .array(columnTargetSchema)
  .refine((m) => m.includes("phoneNumber"), "Map one column to Phone number.")
  .refine((m) => {
    const used = m.filter(Boolean);
    return new Set(used).size === used.length;
  }, "Each field can only be mapped from one column.");
