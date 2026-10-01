import { describe, expect, it } from "vitest";
import { getPlan, plans } from "@/config/plans";

describe("plans", () => {
  it("falls back to the free plan for unknown ids", () => {
    expect(getPlan("does-not-exist").id).toBe("free");
  });

  it("gates API and automations to growth and above", () => {
    expect(plans.free.features.api).toBe(false);
    expect(plans.growth.features.api).toBe(true);
    expect(plans.enterprise.limits.contacts).toBeNull();
  });
});
