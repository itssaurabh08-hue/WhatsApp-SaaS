import type { Metadata } from "next";
import { UsersRoundIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Contacts" };

export default async function Page({ params }: PageProps<"/w/[slug]/contacts">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Contacts"
      description="Everyone you can message."
      icon={UsersRoundIcon}
      emptyTitle="Import your contacts to start messaging."
      emptyDescription="Add contacts one by one or import a CSV file with their opt-in status."
    />
  );
}
