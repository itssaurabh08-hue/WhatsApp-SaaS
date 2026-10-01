import { describe, expect, it } from "vitest";
import {
  buildSendComponents,
  extractVariables,
  mapMetaTemplateStatus,
  missingValues,
  renderTemplateText,
  templateDraftSchema,
  templateRequirements,
  type MetaTemplateComponent,
} from "@/lib/templates";
import { isWindowOpen, windowRemaining } from "@/lib/messaging";

const base = {
  whatsappAccountId: "acc",
  name: "welcome_message",
  language: "en_US",
  category: "MARKETING",
  parameterFormat: "POSITIONAL",
  body: "Hello {{1}}, welcome to {{2}}.",
  examples: { header: {}, body: { "1": "Ana", "2": "Lucky Shrub" } },
};

const errorsOf = (input: Record<string, unknown>) => {
  const r = templateDraftSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("template drafts", () => {
  it("accepts a valid draft", () => {
    expect(errorsOf(base)).toEqual([]);
  });

  it("enforces Meta's naming and variable rules", () => {
    expect(errorsOf({ ...base, name: "Welcome Message" })).toContain(
      "Use only lowercase letters, numbers and underscores",
    );
    expect(errorsOf({ ...base, body: "Hi {{1}} and {{3}}" }).join()).toContain("no gaps");
    expect(errorsOf({ ...base, parameterFormat: "NAMED", body: "Hi {{FirstName}}" }).join()).toContain("lowercase");
    expect(errorsOf({ ...base, examples: { header: {}, body: { "1": "Ana" } } }).join()).toContain("{{2}}");
    expect(errorsOf({ ...base, footer: "Hi {{1}}" }).join()).toContain("footer cannot contain variables");
    expect(errorsOf({ ...base, headerText: "A {{1}} {{2}}" }).join()).toContain("at most one variable");
    expect(errorsOf({ ...base, body: "x".repeat(1025) }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...base, language: "xx_YY" })).toContain("Choose a supported language");
    expect(errorsOf({ ...base, category: "AUTHENTICATION" }).join()).toContain("WhatsApp Manager");
  });

  it("limits buttons as documented", () => {
    const url = (n: number) => ({ type: "URL", text: `Site ${n}`, url: `https://example.com/${n}` });
    expect(errorsOf({ ...base, buttons: [url(1), url(2), url(3)] }).join()).toContain("two website buttons");
    expect(
      errorsOf({ ...base, buttons: [{ type: "URL", text: "Go", url: "https://x.com/{{1}}/path" }] }).join(),
    ).toContain("end of the URL");
    expect(errorsOf({ ...base, buttons: [{ type: "QUICK_REPLY", text: "x".repeat(26) }] }).length).toBe(1);
  });
});

describe("template sending", () => {
  const components: MetaTemplateComponent[] = [
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "Hi {{2}} and {{1}}" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Stop" },
        { type: "URL", text: "Go", url: "https://x.com/{{1}}" },
      ],
    },
  ];

  it("lists what must be supplied", () => {
    const req = templateRequirements(components);
    expect(req).toMatchObject({ header: [], body: ["2", "1"], buttons: [1], headerMedia: "IMAGE", unsupported: null });
    expect(missingValues(req, { body: { "1": "a" } })).toEqual(["{{2}}", "button 2 link value"]);
    expect(templateRequirements([{ type: "HEADER", format: "LOCATION" }]).unsupported).toBe("location header");
  });

  it("orders positional values by number and encodes URL values", () => {
    expect(
      buildSendComponents(
        components,
        "POSITIONAL",
        { body: { "1": "one", "2": "two" }, buttons: { "1": "a b" } },
        "MID",
      ),
    ).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "MID" } }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "a%20b" }] },
    ]);
  });

  it("renders text for history", () => {
    expect(
      renderTemplateText(
        [
          { type: "BODY", text: "Hi {{name}}" },
          { type: "FOOTER", text: "Bye" },
        ],
        { body: { name: "Ana" } },
      ),
    ).toBe("Hi Ana\n\nBye");
    expect(extractVariables("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]);
  });

  it("maps Meta statuses", () => {
    expect(mapMetaTemplateStatus("approved")).toBe("APPROVED");
    expect(mapMetaTemplateStatus("REINSTATED")).toBe("APPROVED");
    expect(mapMetaTemplateStatus("UNARCHIVED")).toBe("UNKNOWN");
    expect(mapMetaTemplateStatus("something")).toBe("UNKNOWN");
  });
});

describe("customer service window", () => {
  it("is open for 24 hours after the last customer message", () => {
    const t = new Date("2026-10-01T10:00:00Z");
    expect(isWindowOpen(null, t)).toBe(false);
    expect(isWindowOpen(new Date("2026-09-30T10:00:01Z"), t)).toBe(true);
    expect(isWindowOpen(new Date("2026-09-30T10:00:00Z"), t)).toBe(false);
    expect(windowRemaining(new Date("2026-10-01T08:30:00Z"), t)).toBe("22h 30m");
  });
});
