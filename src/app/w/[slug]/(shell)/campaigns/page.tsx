import type { Metadata } from "next";
import { MegaphoneIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Campaigns" };

export default async function Page({ params }: PageProps<"/w/[slug]/campaigns">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "campaigns:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Campaigns"
      description="Broadcast approved templates to an audience."
      icon={MegaphoneIcon}
      emptyTitle="Create your first WhatsApp campaign."
      emptyDescription="Choose an audience and an approved template, then send now or schedule."
    />
  );
}
