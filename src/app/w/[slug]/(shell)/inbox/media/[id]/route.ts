import { routeTenantContext } from "@/server/authz/route";
import { db } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import { getStorage } from "@/server/storage";

export const dynamic = "force-dynamic";

const INLINE = /^(image\/(jpeg|png|webp)|video\/(mp4|3gpp)|audio\/)/;

/** Serves a stored media file to members of the workspace that owns it. */
export async function GET(_request: Request, { params }: RouteContext<"/w/[slug]/inbox/media/[id]">) {
  const { slug, id } = await params;
  const ctx = await routeTenantContext(slug, "inbox:read");
  if (ctx instanceof Response) return ctx;
  const media = await db.mediaObject.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!media || media.status !== "STORED" || !media.storageKey) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await getStorage().get(media.storageKey);
  } catch (error) {
    logger.error({ err: error, mediaId: media.id }, "media read failed");
    return new Response("Not found", { status: 404 });
  }
  const inline = INLINE.test(media.mimeType);
  const name = (media.fileName ?? `file-${media.id}`).replace(/["\\\r\n]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? media.mimeType : "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
