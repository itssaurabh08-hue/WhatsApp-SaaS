import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, escapeCsvCell, parseCsv, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses headers and rows, trimming cells and skipping blank lines", () => {
    const r = parseCsv("Name , Mobile\n Ana , +919812345678 \n\n\nBo,+14155552671\n");
    expect(r).toEqual({
      ok: true,
      data: {
        headers: ["Name", "Mobile"],
        rows: [
          ["Ana", "+919812345678"],
          ["Bo", "+14155552671"],
        ],
        warnings: [],
      },
    });
  });

  it("strips a UTF-8 BOM and detects semicolon delimiters", () => {
    const r = parseCsv("﻿name;phone\nAna;+919812345678\n");
    expect(r.ok && r.data.headers).toEqual(["name", "phone"]);
  });

  it("handles quoted fields with commas and newlines", () => {
    const r = parseCsv('name,notes\n"Doe, Jane","line 1\nline 2"\n');
    expect(r.ok && r.data.rows[0]).toEqual(["Doe, Jane", "line 1\nline 2"]);
  });

  it("de-duplicates and fills blank headers", () => {
    const r = parseCsv("phone,phone,\n1,2,3\n");
    expect(r.ok && r.data.headers).toEqual(["phone", "phone (2)", "Column 3"]);
  });

  it("pads short rows and reports field mismatches without crashing", () => {
    const r = parseCsv("a,b,c\n1,2\n1,2,3,4\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rows[0]).toEqual(["1", "2", ""]);
      expect(r.data.rows[1]).toEqual(["1", "2", "3"]);
      expect(r.data.warnings[0]).toMatch(/different number of columns/);
    }
  });

  it("returns friendly errors for unusable files", () => {
    expect(parseCsv("")).toEqual({ ok: false, error: "The file is empty." });
    expect(parseCsv("phone\n")).toMatchObject({ ok: false });
    expect(parseCsv("a\u0000b\n1\n")).toMatchObject({ ok: false });
    expect(parseCsv('"unterminated\n1,2')).toMatchObject({ ok: false });
  });

  it("enforces the row limit", () => {
    const big = "phone\n" + "+919812345678\n".repeat(CSV_MAX_ROWS + 1);
    expect(parseCsv(big)).toMatchObject({ ok: false });
  });
});

describe("CSV output", () => {
  it("neutralizes formula injection but keeps phone numbers intact", () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("+919812345678")).toBe("+919812345678");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  it("round-trips through the parser", () => {
    const csv = toCsv(["Name", "Note"], [["Doe, Jane", 'said "hi"']]);
    const r = parseCsv(csv);
    expect(r.ok && r.data.rows[0]).toEqual(["Doe, Jane", 'said "hi"']);
  });
});
