import type { Metadata } from "next";
import { MegaphoneIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Create campaign" };

export default async function Page({ params }: PageProps<"/w/[slug]/campaigns/new">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "campaigns:manage")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Create campaign"
      description="Set up a new broadcast."
      icon={MegaphoneIcon}
      emptyTitle="Campaign builder"
      emptyDescription="Campaigns need a connected WhatsApp number, contacts and an approved template."
    />
  );
}
