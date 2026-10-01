/**
 * Media types and size limits accepted by WhatsApp (WA/business-phone-numbers/media,
 * "Supported media types", checked 2026-10-01).
 */
export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

const MB = 1024 * 1024;

export const MEDIA_TYPES: Record<string, { kind: MediaKind; maxBytes: number; ext: string }> = {
  "image/jpeg": { kind: "image", maxBytes: 5 * MB, ext: "jpg" },
  "image/png": { kind: "image", maxBytes: 5 * MB, ext: "png" },
  "video/mp4": { kind: "video", maxBytes: 16 * MB, ext: "mp4" },
  "video/3gpp": { kind: "video", maxBytes: 16 * MB, ext: "3gp" },
  "audio/aac": { kind: "audio", maxBytes: 16 * MB, ext: "aac" },
  "audio/amr": { kind: "audio", maxBytes: 16 * MB, ext: "amr" },
  "audio/mpeg": { kind: "audio", maxBytes: 16 * MB, ext: "mp3" },
  "audio/mp4": { kind: "audio", maxBytes: 16 * MB, ext: "m4a" },
  "audio/ogg": { kind: "audio", maxBytes: 16 * MB, ext: "ogg" },
  "text/plain": { kind: "document", maxBytes: 100 * MB, ext: "txt" },
  "application/pdf": { kind: "document", maxBytes: 100 * MB, ext: "pdf" },
  "application/vnd.ms-excel": { kind: "document", maxBytes: 100 * MB, ext: "xls" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "document",
    maxBytes: 100 * MB,
    ext: "xlsx",
  },
  "application/msword": { kind: "document", maxBytes: 100 * MB, ext: "doc" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    maxBytes: 100 * MB,
    ext: "docx",
  },
  "application/vnd.ms-powerpoint": { kind: "document", maxBytes: 100 * MB, ext: "ppt" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    kind: "document",
    maxBytes: 100 * MB,
    ext: "pptx",
  },
  "image/webp": { kind: "sticker", maxBytes: 500 * 1024, ext: "webp" },
};

/**
 * Largest file the team can upload from the browser. Server Actions accept 6 MB
 * bodies (next.config.ts), so outbound uploads are limited below WhatsApp's own limits.
 */
export const MAX_UPLOAD_BYTES = 5 * MB;

/** Largest incoming file we download and keep (WhatsApp documents can be up to 100 MB). */
export const MAX_INBOUND_BYTES = 100 * MB;

/** Types the team can send from the composer (stickers excluded). */
export const UPLOADABLE_TYPES = Object.entries(MEDIA_TYPES)
  .filter(([, v]) => v.kind !== "sticker")
  .map(([mime]) => mime);

export function baseMime(mime: string | null | undefined) {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

export function mediaKindOf(mime: string | null | undefined): MediaKind | null {
  return MEDIA_TYPES[baseMime(mime)]?.kind ?? null;
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
