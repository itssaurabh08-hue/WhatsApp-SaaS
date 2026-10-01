import "server-only";
import { decryptSecret, encryptSecret } from "@/server/crypto/secrets";
import { db } from "@/server/db/client";

/** Stores an encrypted secret for a workspace and returns its id. */
export async function storeCredential(workspaceId: string, kind: string, plaintext: string): Promise<string> {
  const enc = encryptSecret(plaintext);
  const row = await db.credential.create({ data: { workspaceId, kind, ...enc }, select: { id: true } });
  return row.id;
}

export async function readCredential(workspaceId: string, id: string): Promise<string> {
  const row = await db.credential.findFirst({ where: { id, workspaceId } });
  if (!row) throw new Error("credential not found");
  return decryptSecret(row);
}

export async function deleteCredentials(workspaceId: string, ids: (string | null | undefined)[]) {
  const list = ids.filter((x): x is string => !!x);
  if (list.length > 0) await db.credential.deleteMany({ where: { workspaceId, id: { in: list } } });
}
