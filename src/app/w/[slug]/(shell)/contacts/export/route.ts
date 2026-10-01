import { contactFilterSchema } from "@/lib/validation/contacts";
import { routeTenantContext } from "@/server/authz/route";
import { exportContactsCsv } from "@/server/contacts/export";
import { getRequestMeta } from "@/server/request-meta";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/w/[slug]/contacts/export">) {
  const { slug } = await params;
  const ctx = await routeTenantContext(slug, "contacts:export");
  if (ctx instanceof Response) return ctx;

  const url = new URL(request.url);
  const parsed = contactFilterSchema.safeParse({
    q: url.searchParams.get("q") || undefined,
    tagId: url.searchParams.get("tagId") || undefined,
    listId: url.searchParams.get("listId") || undefined,
    segmentId: url.searchParams.get("segmentId") || undefined,
    optInStatus: url.searchParams.get("optInStatus") || undefined,
  });
  if (!parsed.success) return new Response("Invalid filter", { status: 400 });

  const stream = await exportContactsCsv(ctx, parsed.data, await getRequestMeta());
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
