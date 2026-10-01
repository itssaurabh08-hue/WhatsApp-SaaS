import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export type PhoneResult = { ok: true; e164: string; country: string | null } | { ok: false; error: string };

/**
 * Normalizes a phone number to E.164 (e.g. +919812345678), which is what the
 * WhatsApp Business Platform expects and what we use to deduplicate contacts.
 * Numbers without a leading + (or 00) are interpreted using `defaultCountry`.
 */
export function normalizePhone(input: string, defaultCountry?: string | null): PhoneResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Phone number is required." };
  if (raw.length > 40) return { ok: false, error: "Phone number is too long." };
  // Accept the common international prefix 00 as +.
  const text = raw.startsWith("00") ? `+${raw.slice(2)}` : raw;
  // "+91 ...", "(+91) ..." and similar all carry an explicit country code.
  const hasCountryCode = /^[\s(]*\+/.test(text);
  const country = defaultCountry && isSupportedCountry(defaultCountry) ? (defaultCountry as CountryCode) : undefined;
  if (!hasCountryCode && !country) {
    return { ok: false, error: "Add the country code (for example +91) or choose a default country." };
  }
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isValid()) return { ok: false, error: "This is not a valid phone number." };
  return { ok: true, e164: parsed.number, country: parsed.country ?? null };
}

export function isCountryCode(value: string): boolean {
  return isSupportedCountry(value);
}

export interface CountryOption {
  code: string;
  name: string;
  callingCode: string;
}

/** Country options sorted by display name. */
export function listCountries(locale = "en"): CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((code) => ({ code, name: names.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
