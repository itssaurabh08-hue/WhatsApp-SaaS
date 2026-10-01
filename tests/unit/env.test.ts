import { describe, expect, it } from "vitest";
import { parseEnv } from "@/config/env";

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://x",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "x".repeat(32),
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  EMAIL_FROM: "a@b.c",
};

describe("environment validation", () => {
  it("accepts a complete configuration", () => {
    expect(parseEnv(valid).success).toBe(true);
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(parseEnv({ ...valid, AUTH_SECRET: "short" }).success).toBe(false);
  });

  it("rejects missing required variables", () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(parseEnv(rest).success).toBe(false);
  });
});
