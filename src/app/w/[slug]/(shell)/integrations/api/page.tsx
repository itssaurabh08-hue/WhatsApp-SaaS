import type { Metadata } from "next";
import { KeyRoundIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "API" };

export default async function Page({ params }: PageProps<"/w/[slug]/integrations/api">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "api_keys:manage")) return <NoAccess />;
  return (
    <PlannedFeature
      title="API"
      description="API keys for the REST API."
      icon={KeyRoundIcon}
      emptyTitle="No API keys yet."
      emptyDescription="Create an API key to send messages and manage contacts from your own systems."
    />
  );
}
