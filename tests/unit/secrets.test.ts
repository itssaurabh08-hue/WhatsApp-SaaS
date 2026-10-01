import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/server/crypto/secrets";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("secret encryption", () => {
  beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", KEY_A));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("EAAsecret-token");
    expect(enc.ciphertext).not.toContain("EAAsecret");
    expect(decryptSecret(enc)).toBe("EAAsecret-token");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x").iv).not.toBe(encryptSecret("x").iv);
  });

  it("detects tampering", () => {
    const enc = encryptSecret("value");
    const flipped = Buffer.from(enc.ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret({ ...enc, ciphertext: flipped.toString("base64") })).toThrow();
  });

  it("decrypts with the previous key after rotation", () => {
    const enc = encryptSecret("rotate-me");
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    vi.stubEnv("ENCRYPTION_KEY_ID", "k2");
    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", KEY_A);
    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS_ID", "k1");
    expect(decryptSecret(enc)).toBe("rotate-me");
    expect(encryptSecret("new").keyId).toBe("k2");
  });

  it("rejects missing or wrong-length keys", () => {
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
