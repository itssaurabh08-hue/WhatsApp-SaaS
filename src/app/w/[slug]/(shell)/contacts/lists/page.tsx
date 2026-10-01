import type { Metadata } from "next";
import { ListIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Lists" };

export default async function Page({ params }: PageProps<"/w/[slug]/contacts/lists">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Lists"
      description="Static groups of contacts."
      icon={ListIcon}
      emptyTitle="No lists yet."
      emptyDescription="Lists let you group contacts for campaigns."
    />
  );
}
