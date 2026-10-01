import type { Metadata } from "next";
import { TagIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Tags" };

export default async function Page({ params }: PageProps<"/w/[slug]/contacts/tags">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Tags"
      description="Labels for organizing contacts."
      icon={TagIcon}
      emptyTitle="No tags yet."
      emptyDescription="Tags help you segment contacts, for example Customer or VIP."
    />
  );
}
