"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/app/confirm-action";
import { Button } from "@/components/ui/button";
import { disconnectAccountAction, retrySetupAction, syncAccountAction } from "./actions";

export function AccountActions({ slug, accountId, status }: { slug: string; accountId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status === "PENDING_SETUP" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => retrySetupAction(slug, accountId))}>
          Finish setup
        </Button>
      )}
      {status !== "NEEDS_RECONNECT" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => syncAccountAction(slug, accountId))}
        >
          Refresh status
        </Button>
      )}
      <ConfirmAction
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            Disconnect
          </Button>
        }
        title="Disconnect this number?"
        description="Messages to and from this number will stop flowing through this workspace. The number stays in your Meta account and you can reconnect it later."
        confirmLabel="Disconnect"
        action={async () => {
          const r = await disconnectAccountAction(slug, accountId);
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
          router.refresh();
        }}
      />
    </div>
  );
}
