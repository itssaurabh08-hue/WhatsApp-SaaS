import type { Metadata } from "next";
import { FileTextIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Templates" };

export default async function Page({ params }: PageProps<"/w/[slug]/templates">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "templates:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Templates"
      description="WhatsApp message templates and their approval status."
      icon={FileTextIcon}
      emptyTitle="Create an approved WhatsApp template to start campaigns."
      emptyDescription="Templates are reviewed by Meta before you can use them."
    />
  );
}
