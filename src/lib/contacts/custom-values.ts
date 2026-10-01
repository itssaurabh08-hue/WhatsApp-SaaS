export type CustomFieldTypeName = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";

/**
 * Custom field values are stored as normalized strings so they can be filtered
 * uniformly: NUMBER as a plain decimal, DATE as YYYY-MM-DD, BOOLEAN as
 * "true"/"false". Returns null for an empty input.
 */
export function coerceCustomValue(
  type: CustomFieldTypeName,
  raw: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  switch (type) {
    case "TEXT":
      return v.length > 500 ? { ok: false, error: "is longer than 500 characters" } : { ok: true, value: v };
    case "NUMBER": {
      const n = Number(v.replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: String(n) } : { ok: false, error: "is not a number" };
    }
    case "DATE": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !d || d.getUTCDate() !== Number(m[3]))
        return { ok: false, error: "is not a date in YYYY-MM-DD format" };
      return { ok: true, value: v };
    }
    case "BOOLEAN": {
      const b = v.toLowerCase();
      if (["true", "yes", "y", "1"].includes(b)) return { ok: true, value: "true" };
      if (["false", "no", "n", "0"].includes(b)) return { ok: true, value: "false" };
      return { ok: false, error: "is not yes/no" };
    }
  }
}

type OptIn = "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";

/** Timestamp updates for an opt-in status change. History timestamps are kept, never cleared. */
export function optInTransition(previous: OptIn | null, next: OptIn, now: Date) {
  if (previous === next) return {};
  if (next === "OPTED_IN") return { optInStatus: next, optInAt: now };
  if (next === "OPTED_OUT") return { optInStatus: next, optedOutAt: now };
  return { optInStatus: next };
}
