import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for credentials stored in the database (Meta access
 * tokens, registration PINs). The key comes from ENCRYPTION_KEY (32 bytes,
 * base64). Ciphertexts carry a key id so keys can be rotated: add the new key
 * as ENCRYPTION_KEY, move the old one to ENCRYPTION_KEY_PREVIOUS with its id.
 */
const ALGORITHM = "aes-256-gcm";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
}

function keyFromBase64(value: string | undefined, name: string): Buffer {
  if (!value) throw new Error(`${name} is not set`);
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
  return key;
}

function currentKey() {
  return {
    id: process.env.ENCRYPTION_KEY_ID ?? "k1",
    key: keyFromBase64(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY"),
  };
}

function keyForId(id: string): Buffer {
  const current = currentKey();
  if (id === current.id) return current.key;
  if (id === process.env.ENCRYPTION_KEY_PREVIOUS_ID) {
    return keyFromBase64(process.env.ENCRYPTION_KEY_PREVIOUS, "ENCRYPTION_KEY_PREVIOUS");
  }
  throw new Error(`No encryption key available for key id "${id}"`);
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const { id, key } = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyId: id,
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, keyForId(secret.keyId), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function isEncryptionConfigured(): boolean {
  try {
    currentKey();
    return true;
  } catch {
    return false;
  }
}
