"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/app/confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteCampaignAction, launchAction, stateAction } from "../actions";

export function CampaignActions({
  slug,
  id,
  status,
  canSend,
  canManage,
  timezone,
}: {
  slug: string;
  id: string;
  status: string;
  canSend: boolean;
  canManage: boolean;
  timezone: string;
}) {
  const [pending, start] = useTransition();
  const [when, setWhen] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message?: string } | void>) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) toast.error(r.message ?? "That did not work.");
      else if (r?.message) toast.success(r.message);
    });

  return (
    <div className="flex flex-wrap items-end gap-2">
      {canSend && status === "DRAFT" && (
        <>
          <div className="grid gap-1">
            <Label htmlFor="when" className="text-xs">
              Schedule ({timezone}), or leave empty to send now
            </Label>
            <Input
              id="when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-56"
            />
          </div>
          <ConfirmAction
            destructive={false}
            trigger={<Button disabled={pending}>{when ? "Schedule campaign" : "Send now"}</Button>}
            title={when ? "Schedule this campaign?" : "Send this campaign now?"}
            description="Messages go to every eligible contact in the audience. WhatsApp charges per delivered template message."
            confirmLabel={when ? "Schedule" : "Send now"}
            action={async () => {
              const fd = new FormData();
              fd.set("scheduledAt", when);
              return launchAction(slug, id, fd);
            }}
          />
        </>
      )}
      {canSend && ["SENDING", "SCHEDULED"].includes(status) && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => stateAction(slug, id, "pause"))}>
          Pause
        </Button>
      )}
      {canSend && status === "PAUSED" && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => stateAction(slug, id, "resume"))}>
          Resume
        </Button>
      )}
      {canSend && ["SENDING", "SCHEDULED", "PAUSED"].includes(status) && (
        <ConfirmAction
          trigger={<Button variant="outline">Cancel campaign</Button>}
          title="Cancel this campaign?"
          description="Contacts who have not been sent the message yet will not receive it. Messages already sent are not affected. This cannot be undone."
          confirmLabel="Cancel campaign"
          action={() => stateAction(slug, id, "cancel")}
        />
      )}
      {canManage && ["DRAFT", "COMPLETED", "CANCELLED"].includes(status) && (
        <ConfirmAction
          trigger={<Button variant="ghost">Delete</Button>}
          title="Delete this campaign?"
          description="The campaign and its recipient list are deleted. Sent messages stay in the inbox."
          confirmLabel="Delete"
          action={() => deleteCampaignAction(slug, id)}
        />
      )}
    </div>
  );
}
