"use client";

import { ConnectWhatsAppButton } from "@/components/app/connect-whatsapp-button";
import { completeConnectionAction } from "./actions";

export function Connect({
  slug,
  appId,
  configId,
  apiVersion,
  label,
}: {
  slug: string;
  appId: string;
  configId: string;
  apiVersion: string;
  label?: string;
}) {
  return (
    <ConnectWhatsAppButton
      appId={appId}
      configId={configId}
      apiVersion={apiVersion}
      label={label}
      onComplete={(input) => completeConnectionAction(slug, input)}
    />
  );
}
