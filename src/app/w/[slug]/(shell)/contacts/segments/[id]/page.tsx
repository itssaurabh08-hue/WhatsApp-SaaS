import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { can, getTenantContext } from "@/server/authz/tenant";
import { getSegment } from "@/server/contacts/segments";
import { isAppError } from "@/server/errors";
import { deleteSegmentAction } from "../../actions";
import { SegmentBuilder } from "../segment-builder";
import { segmentBuilderOptions } from "../segment-options";

export const metadata: Metadata = { title: "Edit segment" };

export default async function EditSegmentPage({ params }: PageProps<"/w/[slug]/contacts/segments/[id]">) {
  const { slug, id } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "segments:manage")) return <NoAccess />;
  const segment = await getSegment(ctx, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const options = await segmentBuilderOptions(ctx);
  return (
    <>
      <PageHeader
        title={`Edit ${segment.name}`}
        actions={
          <ConfirmAction
            trigger={
              <Button variant="outline">
                <Trash2Icon />
                Delete
              </Button>
            }
            title={`Delete segment "${segment.name}"?`}
            description="The saved segment is deleted. Contacts are not affected."
            confirmLabel="Delete segment"
            action={deleteSegmentAction.bind(null, slug, id)}
          />
        }
      />
      <Card className="max-w-4xl">
        <CardContent>
          <SegmentBuilder slug={slug} segmentId={id} initial={segment} {...options} />
        </CardContent>
      </Card>
    </>
  );
}
