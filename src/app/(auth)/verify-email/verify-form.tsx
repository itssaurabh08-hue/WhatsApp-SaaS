"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "../actions";

/**
 * Verification requires an explicit click (POST) rather than happening on page
 * load, so link scanners that prefetch email URLs cannot consume the token.
 */
export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action] = useActionState(verifyEmailAction, {});
  if (state.ok) {
    return (
      <div className="grid gap-4">
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/">Continue</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="token" value={token} />
      <SubmitButton className="w-full" pendingLabel="Verifying…">
        Verify my email
      </SubmitButton>
    </form>
  );
}
