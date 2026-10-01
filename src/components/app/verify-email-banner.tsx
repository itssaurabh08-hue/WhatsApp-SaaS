"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/app/submit-button";
import { resendVerificationAction } from "@/app/(auth)/actions";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, action] = useActionState(resendVerificationAction, {});
  return (
    <div className="bg-warning/10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm lg:px-6">
      <span>
        {state.message ?? (
          <>
            Verify <span className="font-medium">{email}</span> to connect WhatsApp and send messages.
          </>
        )}
      </span>
      {!state.ok && (
        <form action={action}>
          <SubmitButton variant="link" size="sm" className="h-auto p-0" pendingLabel="Sending…">
            Resend email
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
