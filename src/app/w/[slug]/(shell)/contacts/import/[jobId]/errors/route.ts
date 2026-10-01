import { routeTenantContext } from "@/server/authz/route";
import { importErrorsCsv } from "@/server/contacts/imports";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/w/[slug]/contacts/import/[jobId]/errors">) {
  const { slug, jobId } = await params;
  const ctx = await routeTenantContext(slug, "contacts:import");
  if (ctx instanceof Response) return ctx;
  try {
    const { fileName, csv } = await importErrorsCsv(ctx, jobId);
    const safeName = fileName.replace(/[^\w.-]+/g, "_");
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") return new Response("Not found", { status: 404 });
    throw error;
  }
}
