"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { assignAction, setStatusAction } from "./actions";

export function ConversationControls({
  slug,
  conversationId,
  status,
  assignedUserId,
  members,
  canAssign,
  canReply,
}: {
  slug: string;
  conversationId: string;
  status: string;
  assignedUserId: string | null;
  members: { id: string; name: string }[];
  canAssign: boolean;
  canReply: boolean;
}) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved.");
      else toast.error(r.message ?? "That did not work.");
    });

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label htmlFor="assignee" className="text-muted-foreground text-xs font-medium">
          Assigned to
        </label>
        <NativeSelect
          id="assignee"
          disabled={!canAssign || pending}
          value={assignedUserId ?? ""}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("userId", e.target.value);
            run(() => assignAction(slug, conversationId, fd));
          }}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {canReply && (
        <div className="flex flex-wrap gap-2">
          {status !== "CLOSED" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => setStatusAction(slug, conversationId, "CLOSED"))}
              >
                Close conversation
              </Button>
              {status !== "PENDING" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => setStatusAction(slug, conversationId, "PENDING"))}
                >
                  Mark pending
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => setStatusAction(slug, conversationId, "OPEN"))}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
