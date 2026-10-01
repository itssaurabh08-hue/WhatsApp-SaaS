import type { Metadata } from "next";
import Link from "next/link";
import { FilterIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { segmentDefinitionSchema } from "@/lib/segments";
import { can, getTenantContext } from "@/server/authz/tenant";
import { countSegment, listSegments } from "@/server/contacts/segments";

export const metadata: Metadata = { title: "Segments" };

export default async function SegmentsPage({ params }: PageProps<"/w/[slug]/contacts/segments">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const segments = await listSegments(ctx);
  const counts = await Promise.all(
    segments.map(async (s) => {
      const def = segmentDefinitionSchema.safeParse(s.definition);
      return def.success ? countSegment(ctx, def.data) : null;
    }),
  );
  const canManage = can(ctx, "segments:manage");
  return (
    <>
      <PageHeader
        title="Segments"
        description="Saved audiences that update automatically as contacts change."
        actions={
          canManage ? (
            <Button asChild>
              <Link href={`/w/${slug}/contacts/segments/new`}>
                <PlusIcon />
                New segment
              </Link>
            </Button>
          ) : undefined
        }
      />
      {segments.length === 0 ? (
        <EmptyState
          icon={FilterIcon}
          title="No segments yet."
          description="For example: contacts where Tag is Customer AND City is Delhi."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Segment</TableHead>
                <TableHead>Matching contacts</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    <Link className="font-medium hover:underline" href={`/w/${slug}/contacts?segmentId=${s.id}`}>
                      {s.name}
                    </Link>
                    {s.description && (
                      <div className="text-muted-foreground max-w-md truncate text-xs">{s.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {counts[i]?.toLocaleString("en-US") ?? "Invalid definition"}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {canManage && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/w/${slug}/contacts/segments/${s.id}`}>Edit</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
