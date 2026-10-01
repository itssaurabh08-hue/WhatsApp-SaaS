import Papa from "papaparse";

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 100_000;
export const CSV_MAX_COLUMNS = 100;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Non-fatal problems (e.g. rows with too many/few fields). */
  warnings: string[];
}

export type ParseCsvResult = { ok: true; data: ParsedCsv } | { ok: false; error: string };

/**
 * Parses CSV text defensively: never throws, strips a BOM, auto-detects the
 * delimiter, trims and de-duplicates headers, drops blank lines and enforces
 * row/column limits.
 */
export function parseCsv(text: string): ParseCsvResult {
  const content = text.replace(/^﻿/, "");
  if (!content.trim()) return { ok: false, error: "The file is empty." };
  if (content.includes("\u0000")) return { ok: false, error: "This does not look like a text CSV file." };

  let result: Papa.ParseResult<string[]>;
  try {
    result = Papa.parse<string[]>(content, { skipEmptyLines: "greedy" });
  } catch {
    return { ok: false, error: "The file could not be read as CSV." };
  }

  const [headerRow, ...dataRows] = result.data;
  if (!headerRow || headerRow.length === 0) return { ok: false, error: "The file has no header row." };
  if (headerRow.length > CSV_MAX_COLUMNS) {
    return { ok: false, error: `The file has more than ${CSV_MAX_COLUMNS} columns.` };
  }
  if (dataRows.length === 0) return { ok: false, error: "The file has a header row but no contacts." };
  if (dataRows.length > CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `The file has more than ${CSV_MAX_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`,
    };
  }

  const seen = new Map<string, number>();
  const headers = headerRow.map((h, i) => {
    const base = (h ?? "").trim() || `Column ${i + 1}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  const warnings: string[] = [];
  // Papaparse only reports field mismatches in header mode, so count them here.
  const mismatched = dataRows.filter((r) => r.length !== headerRow.length).length;
  if (mismatched > 0) warnings.push(`${mismatched} row(s) have a different number of columns than the header.`);
  const quoteErrors = result.errors.filter((e) => e.type === "Quotes").length;
  if (quoteErrors > 0) warnings.push(`${quoteErrors} row(s) have unbalanced quotes and may be split incorrectly.`);

  const rows = dataRows.map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { ok: true, data: { headers, rows, warnings } };
}

/**
 * Neutralizes spreadsheet formula injection: cells starting with = + - @ tab
 * or CR are prefixed with a quote. Plain international phone numbers such as
 * +919812345678 are left untouched because they cannot be formulas.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/^\+\d[\d ]*$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return Papa.unparse({ fields: headers, data: rows.map((r) => r.map(escapeCsvCell)) }, { newline: "\r\n" });
}
