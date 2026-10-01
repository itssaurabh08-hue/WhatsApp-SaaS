import "server-only";
import { createHash } from "node:crypto";
import { baseMime, MAX_INBOUND_BYTES, MAX_UPLOAD_BYTES, MEDIA_TYPES } from "@/lib/media";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { MetaApiError } from "@/server/providers/whatsapp/meta/errors";
import { getStorage, storageKey } from "@/server/storage";
import { readCredential } from "@/server/whatsapp/credentials";

/** Sniffs the real file type from its first bytes so a renamed file cannot pass as another type. */
export function sniffMime(data: Uint8Array): string | null {
  const b = data;
  const starts = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (brand.startsWith("3gp")) return "video/3gpp";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  if (starts(0x4f, 0x67, 0x67, 0x53)) return "audio/ogg";
  if (starts(0x23, 0x21, 0x41, 0x4d, 0x52)) return "audio/amr";
  if (starts(0x49, 0x44, 0x33) || starts(0xff, 0xfb) || starts(0xff, 0xf3)) return "audio/mpeg";
  if (starts(0xff, 0xf1) || starts(0xff, 0xf9)) return "audio/aac";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "application/zip"; // docx/xlsx/pptx container
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return "application/x-ole"; // doc/xls/ppt container
  return null;
}

function contentMatches(declared: string, sniffed: string | null): boolean {
  if (declared === "text/plain") return sniffed === null;
  if (declared.includes("openxmlformats")) return sniffed === "application/zip";
  if (["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(declared)) {
    return sniffed === "application/x-ole";
  }
  if (declared === "audio/mp4" || declared === "video/mp4") return sniffed === "audio/mp4" || sniffed === "video/mp4";
  return sniffed === declared;
}

/** Stores a file uploaded by a team member and returns the MediaObject. */
export async function storeUpload(
  workspaceId: string,
  userId: string,
  file: { name: string; type: string; data: Uint8Array },
) {
  const mime = baseMime(file.type);
  const spec = MEDIA_TYPES[mime];
  if (!spec || spec.kind === "sticker") {
    throw new AppError("VALIDATION", {
      userMessage: "WhatsApp does not accept this file type. Use JPEG, PNG, MP4, PDF, Office documents or audio.",
    });
  }
  if (file.data.length === 0) throw new AppError("VALIDATION", { userMessage: "The file is empty." });
  const limit = Math.min(spec.maxBytes, MAX_UPLOAD_BYTES);
  if (file.data.length > limit) {
    throw new AppError("VALIDATION", {
      userMessage: `The file is too large. The limit for this type is ${Math.round(limit / 1024 / 1024)} MB.`,
    });
  }
  if (!contentMatches(mime, sniffMime(file.data))) {
    throw new AppError("VALIDATION", { userMessage: "The file content does not match its type." });
  }
  const fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || `file.${spec.ext}`;
  const media = await db.mediaObject.create({
    data: {
      workspaceId,
      mimeType: mime,
      size: file.data.length,
      fileName,
      sha256: createHash("sha256").update(file.data).digest("hex"),
      uploadedById: userId,
      status: "PENDING",
    },
  });
  const key = storageKey(workspaceId, media.id);
  await getStorage().put(key, file.data, mime);
  return db.mediaObject.update({ where: { id: media.id, workspaceId }, data: { storageKey: key, status: "STORED" } });
}

/**
 * Returns a Meta media id for a stored file, uploading it on first use.
 * Uploaded media ids are valid for 30 days (WA/business-phone-numbers/media).
 */
export async function ensureProviderMedia(
  workspaceId: string,
  mediaObjectId: string,
  account: { id: string; phoneNumberId: string },
  token: string,
  callCtx: { workspaceId: string; whatsappAccountId: string },
): Promise<string> {
  const media = await db.mediaObject.findFirst({ where: { id: mediaObjectId, workspaceId } });
  if (!media?.storageKey) throw new AppError("VALIDATION", { userMessage: "The file is no longer available." });
  const reusable =
    media.providerMediaId &&
    media.providerPhoneId === account.phoneNumberId &&
    media.providerUploadedAt &&
    Date.now() - media.providerUploadedAt.getTime() < 29 * 24 * 3600 * 1000;
  if (reusable && media.providerMediaId) return media.providerMediaId;
  const data = await getStorage().get(media.storageKey);
  const id = await getWhatsAppProvider().uploadMedia(
    account.phoneNumberId,
    { data, mimeType: media.mimeType, fileName: media.fileName ?? "file" },
    token,
    callCtx,
  );
  await db.mediaObject.updateMany({
    where: { id: media.id, workspaceId },
    data: { providerMediaId: id, providerPhoneId: account.phoneNumberId, providerUploadedAt: new Date() },
  });
  return id;
}

/**
 * Downloads a customer's media file (worker job). Meta media URLs expire after
 * 5 minutes, so a fresh URL is requested on every attempt; the media id itself
 * stays downloadable for 7 days.
 */
export async function downloadInboundMedia(job: {
  mediaObjectId: string;
  workspaceId: string;
  whatsappAccountId: string;
  finalAttempt: boolean;
}): Promise<"stored" | "skipped" | "failed"> {
  const { workspaceId } = job;
  const media = await db.mediaObject.findFirst({ where: { id: job.mediaObjectId, workspaceId } });
  if (!media || media.status === "STORED" || !media.providerMediaId) return "skipped";
  const account = await db.whatsAppAccount.findFirst({ where: { id: job.whatsappAccountId, workspaceId } });
  if (!account?.accessTokenRef) {
    await db.mediaObject.updateMany({
      where: { id: media.id, workspaceId },
      data: { status: "FAILED", error: "WhatsApp number not connected" },
    });
    return "failed";
  }
  const callCtx = { workspaceId, whatsappAccountId: account.id };
  try {
    const token = await readCredential(workspaceId, account.accessTokenRef);
    const provider = getWhatsAppProvider();
    const info = await provider.getMediaInfo(media.providerMediaId, token, callCtx);
    if (info.fileSize && info.fileSize > MAX_INBOUND_BYTES) throw new AppError("VALIDATION", { message: "too large" });
    const file = await provider.downloadMedia(info.url, token, MAX_INBOUND_BYTES, callCtx);
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    const key = storageKey(workspaceId, media.id);
    const mime = baseMime(info.mimeType ?? file.contentType ?? media.mimeType) || "application/octet-stream";
    await getStorage().put(key, file.data, mime);
    await db.mediaObject.updateMany({
      where: { id: media.id, workspaceId },
      data: { status: "STORED", storageKey: key, size: file.data.length, sha256, mimeType: mime, error: null },
    });
    return "stored";
  } catch (error) {
    const permanent =
      error instanceof AppError || (error instanceof MetaApiError && !error.info.retryable && error.httpStatus !== 404);
    if (permanent || job.finalAttempt) {
      logger.warn({ err: error, mediaObjectId: media.id }, "inbound media download failed");
      await db.mediaObject.updateMany({
        where: { id: media.id, workspaceId },
        data: { status: "FAILED", error: String((error as Error).message).slice(0, 300) },
      });
      return "failed";
    }
    throw error;
  }
}
