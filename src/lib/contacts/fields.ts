/** Built-in contact fields that CSV columns can map to. */
export const STANDARD_FIELDS = [
  { key: "phoneNumber", label: "Phone number", required: true },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name (split into first/last)" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "country", label: "Country (2-letter code)" },
  { key: "optInStatus", label: "Opt-in status" },
  { key: "tags", label: "Tags (comma separated)" },
] as const;

export type StandardFieldKey = (typeof STANDARD_FIELDS)[number]["key"];

/** Mapping value: a standard field, `custom:<key>`, or "" to ignore the column. */
export type ColumnTarget = StandardFieldKey | `custom:${string}` | "";

const SYNONYMS: Record<StandardFieldKey, string[]> = {
  phoneNumber: [
    "phone",
    "phonenumber",
    "mobile",
    "mobilenumber",
    "whatsapp",
    "whatsappnumber",
    "cell",
    "cellphone",
    "msisdn",
    "number",
    "contactnumber",
    "tel",
    "telephone",
  ],
  firstName: ["firstname", "first", "givenname", "fname"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  fullName: ["name", "fullname", "contactname", "customername"],
  email: ["email", "emailaddress", "mail", "e-mail"],
  company: ["company", "companyname", "organization", "organisation", "business", "businessname"],
  country: ["country", "countrycode"],
  optInStatus: ["optin", "optinstatus", "consent", "whatsappoptin", "subscribed", "subscription"],
  tags: ["tags", "tag", "labels", "label", "groups"],
};

function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Suggests a target for each header; each target is used at most once. */
export function suggestMapping(headers: string[], customFieldKeys: string[] = []): ColumnTarget[] {
  const used = new Set<string>();
  return headers.map((header) => {
    const h = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(SYNONYMS) as [StandardFieldKey, string[]][]) {
      if (!used.has(field) && synonyms.includes(h)) {
        used.add(field);
        return field;
      }
    }
    const custom = customFieldKeys.find((k) => normalizeHeader(k) === h && !used.has(`custom:${k}`));
    if (custom) {
      used.add(`custom:${custom}`);
      return `custom:${custom}` as const;
    }
    return "";
  });
}

const OPT_IN_TRUE = new Set(["yes", "y", "true", "1", "optedin", "optin", "opted_in", "subscribed", "granted"]);
const OPT_IN_FALSE = new Set(["no", "n", "false", "0", "optedout", "optout", "opted_out", "unsubscribed", "revoked"]);

export function parseOptIn(value: string): "OPTED_IN" | "OPTED_OUT" | "UNKNOWN" | null {
  const v = value.trim().toLowerCase().replace(/[\s-]/g, "");
  if (!v) return "UNKNOWN";
  if (OPT_IN_TRUE.has(v)) return "OPTED_IN";
  if (OPT_IN_FALSE.has(v)) return "OPTED_OUT";
  if (v === "unknown") return "UNKNOWN";
  return null;
}

export function splitFullName(full: string): { firstName: string | null; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function contactDisplayName(c: {
  firstName?: string | null;
  lastName?: string | null;
  normalizedPhoneNumber?: string;
  phoneNumber?: string;
}) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return name || c.normalizedPhoneNumber || c.phoneNumber || "Unknown";
}

export const TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const OPT_IN_LABELS = {
  UNKNOWN: "Unknown",
  OPTED_IN: "Opted in",
  OPTED_OUT: "Opted out",
} as const;
