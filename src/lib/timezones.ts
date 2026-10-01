/**
 * ICU still reports some zones under their legacy names (e.g. Asia/Calcutta).
 * Show the current IANA names users expect; both forms are valid identifiers.
 */
const MODERN_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
};

/** IANA timezones for pickers, UTC first. `include` guarantees a stored value is selectable. */
export function listTimezones(include?: string): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const set = new Set(zones.map((z) => MODERN_NAMES[z] ?? z));
  set.delete("UTC");
  if (include && include !== "UTC") set.add(include);
  return ["UTC", ...[...set].sort()];
}
