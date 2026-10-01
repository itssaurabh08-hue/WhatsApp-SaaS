import { z } from "zod";
import { CURRENCIES } from "@/lib/currencies";
import { isCountryCode } from "@/lib/phone";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "dashboard",
  "help",
  "login",
  "logout",
  "new",
  "onboarding",
  "settings",
  "signup",
  "support",
  "w",
  "www",
]);

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, "Use 3-48 lowercase letters, numbers or hyphens.")
  .refine((s) => !RESERVED_SLUGS.has(s), "This URL is reserved. Choose another.");

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Choose a valid timezone.");

export const currencySchema = z.enum(CURRENCIES, { error: "Choose a supported currency." });

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80),
  slug: workspaceSlugSchema.optional().or(z.literal("").transform(() => undefined)),
});

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https:\/\//i.test(v), "Use an https:// URL.")
  .transform((v) => (v === "" ? null : v));

export const businessSettingsSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name.").max(120),
  timezone: timezoneSchema,
  currency: currencySchema,
  defaultCountry: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || isCountryCode(v), "Choose a valid country.")
    .transform((v) => (v === "" ? null : v)),
});

export const workspaceSettingsSchema = businessSettingsSchema.extend({
  name: z.string().trim().min(2).max(80),
  logoUrl: optionalUrl,
});
