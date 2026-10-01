import type { Metadata } from "next";
import { BarChart3Icon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Analytics" };

export default async function Page({ params }: PageProps<"/w/[slug]/analytics">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "analytics:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Analytics"
      description="Delivery, read and response metrics."
      icon={BarChart3Icon}
      emptyTitle="No message data yet."
      emptyDescription="Metrics are calculated from real delivery events once you start sending."
    />
  );
}
