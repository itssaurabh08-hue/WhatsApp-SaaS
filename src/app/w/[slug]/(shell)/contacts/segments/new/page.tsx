import type { Metadata } from "next";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { can, getTenantContext } from "@/server/authz/tenant";
import { SegmentBuilder } from "../segment-builder";
import { segmentBuilderOptions } from "../segment-options";

export const metadata: Metadata = { title: "New segment" };

export default async function NewSegmentPage({ params }: PageProps<"/w/[slug]/contacts/segments/new">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "segments:manage")) return <NoAccess />;
  const options = await segmentBuilderOptions(ctx);
  return (
    <>
      <PageHeader title="New segment" description="Combine conditions to define an audience." />
      <Card className="max-w-4xl">
        <CardContent>
          <SegmentBuilder slug={slug} segmentId={null} {...options} />
        </CardContent>
      </Card>
    </>
  );
}
