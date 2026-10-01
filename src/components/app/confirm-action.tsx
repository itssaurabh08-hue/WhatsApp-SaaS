"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Button that asks for confirmation before running a (server) action. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  action,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const result = await action();
                  // Actions may return { ok, message } to report the outcome.
                  if (result && typeof result === "object" && "ok" in result) {
                    const r = result as { ok: boolean; message?: string };
                    if (!r.ok) {
                      toast.error(r.message ?? "That did not work. Please try again.");
                      return;
                    }
                    if (r.message) toast.success(r.message);
                  }
                  setOpen(false);
                } catch (error) {
                  // Redirects thrown by server actions must propagate.
                  if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
                  if (
                    typeof error === "object" &&
                    error &&
                    "digest" in error &&
                    String(error.digest).startsWith("NEXT_REDIRECT")
                  )
                    throw error;
                  toast.error("That did not work. Please try again.");
                }
              })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
