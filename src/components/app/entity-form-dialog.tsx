"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ActionState } from "@/lib/action-state";

/**
 * Dialog wrapping a small create/edit form backed by a server action that
 * returns ActionState. Closes and toasts on success.
 */
export function EntityFormDialog<F extends string>({
  trigger,
  title,
  description,
  submitLabel,
  action,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  action: (prev: ActionState<F>, formData: FormData) => Promise<ActionState<F>>;
  children: (state: ActionState<F>) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && (
          <InnerForm action={action} submitLabel={submitLabel} onDone={() => setOpen(false)}>
            {children}
          </InnerForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InnerForm<F extends string>({
  action,
  submitLabel,
  onDone,
  children,
}: {
  action: (prev: ActionState<F>, formData: FormData) => Promise<ActionState<F>>;
  submitLabel: string;
  onDone: () => void;
  children: (state: ActionState<F>) => React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) {
      if (state.message) toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {!state.ok && state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {children(state)}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
