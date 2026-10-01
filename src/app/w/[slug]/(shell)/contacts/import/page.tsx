import type { Metadata } from "next";
import { UploadIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Import contacts" };

export default async function Page({ params }: PageProps<"/w/[slug]/contacts/import">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "contacts:import")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Import contacts"
      description="Upload a CSV file of contacts."
      icon={UploadIcon}
      emptyTitle="Import contacts from a CSV file."
      emptyDescription="Map columns, review validation and duplicates, then import."
    />
  );
}
