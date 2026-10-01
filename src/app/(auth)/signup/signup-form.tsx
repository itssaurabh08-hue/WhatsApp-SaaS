"use client";

import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { signupAction } from "../actions";

export function SignupForm() {
  const [state, action] = useActionState(signupAction, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField id="name" label="Your name" error={state.fieldErrors?.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          defaultValue={state.values?.name}
          aria-invalid={!!state.fieldErrors?.name}
        />
      </FormField>
      <FormField id="email" label="Work email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={!!state.fieldErrors?.email}
        />
      </FormField>
      <FormField
        id="password"
        label="Password"
        error={state.fieldErrors?.password}
        hint={`At least ${PASSWORD_MIN} characters.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          aria-invalid={!!state.fieldErrors?.password}
        />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
