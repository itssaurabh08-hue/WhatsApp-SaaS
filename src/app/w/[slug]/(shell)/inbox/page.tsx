import type { Metadata } from "next";
import { InboxIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PlannedFeature } from "@/components/app/planned-feature";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Inbox" };

export default async function Page({ params }: PageProps<"/w/[slug]/inbox">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "inbox:read")) return <NoAccess />;
  return (
    <PlannedFeature
      title="Inbox"
      description="Conversations with your customers."
      icon={InboxIcon}
      emptyTitle="Your incoming conversations will appear here."
      emptyDescription="Once WhatsApp is connected, customer messages arrive here for your team to answer."
    />
  );
}
