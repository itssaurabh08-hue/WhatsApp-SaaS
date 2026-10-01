import type { Metadata } from "next";
import { WebhookIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Webhooks" };

export default async function Page({ params }: PageProps<"/w/[slug]/integrations/webhooks">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "webhooks:manage")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Webhooks"
      description="Send events to your own systems."
      icon={WebhookIcon}
      emptyTitle="No webhook endpoints yet."
      emptyDescription="Receive signed events such as message.received and message.delivered."
    />
  );
}
