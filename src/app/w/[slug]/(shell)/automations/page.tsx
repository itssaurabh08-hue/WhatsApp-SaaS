import type { Metadata } from "next";
import { WorkflowIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Automations" };

export default async function Page({ params }: PageProps<"/w/[slug]/automations">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "automations:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Automations"
      description="Simple trigger and action workflows."
      icon={WorkflowIcon}
      emptyTitle="No automations yet."
      emptyDescription="For example: when a contact is tagged, send a template."
    />
  );
}
