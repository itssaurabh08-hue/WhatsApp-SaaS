"use client";

import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { resetPasswordAction } from "../actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      {(state.message || state.fieldErrors?.token) && (
        <Alert variant="destructive">
          <AlertDescription>{state.message ?? "This reset link is invalid."}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="token" value={token} />
      <FormField
        id="password"
        label="New password"
        error={state.fieldErrors?.password}
        hint={`At least ${PASSWORD_MIN} characters.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!state.fieldErrors?.password}
        />
      </FormField>
      <FormField id="confirmPassword" label="Confirm new password" error={state.fieldErrors?.confirmPassword}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!state.fieldErrors?.confirmPassword}
        />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        Set new password
      </SubmitButton>
    </form>
  );
}
