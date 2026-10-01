"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/app/submit-button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/action-state";

export function NoteForm({
  action,
}: {
  action: (prev: ActionState<"body">, formData: FormData) => Promise<ActionState<"body">>;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid gap-2">
      <label htmlFor="note-body" className="sr-only">
        Add an internal note
      </label>
      <Textarea
        id="note-body"
        name="body"
        placeholder="Add an internal note. Notes are only visible to your team."
        aria-invalid={!!state.fieldErrors?.body}
      />
      {(state.fieldErrors?.body || (!state.ok && state.message)) && (
        <p className="text-destructive text-sm">{state.fieldErrors?.body ?? state.message}</p>
      )}
      <div>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}
