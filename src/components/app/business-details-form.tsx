"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionState } from "@/lib/action-state";
import { CURRENCIES } from "@/lib/currencies";

type Fields = "name" | "businessName" | "timezone" | "currency" | "defaultCountry" | "logoUrl";

interface Props {
  action: (prev: ActionState<Fields>, formData: FormData) => Promise<ActionState<Fields>>;
  timezones: string[];
  countries: { code: string; name: string; callingCode: string }[];
  defaults: Partial<Record<Fields, string>>;
  /** Full settings form shows workspace name and logo; onboarding shows business fields only. */
  variant: "onboarding" | "settings";
  disabled?: boolean;
}

export function BusinessDetailsForm({ action, timezones, countries, defaults, variant, disabled }: Props) {
  const [state, formAction] = useActionState(action, {});
  const v = { ...defaults, ...state.values };

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {!state.ok && state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <fieldset disabled={disabled} className="grid gap-4">
        {variant === "settings" && (
          <FormField id="name" label="Workspace name" error={state.fieldErrors?.name}>
            <Input id="name" name="name" defaultValue={v.name} aria-invalid={!!state.fieldErrors?.name} />
          </FormField>
        )}
        <FormField
          id="businessName"
          label="Business name"
          error={state.fieldErrors?.businessName}
          hint="Shown to your team. Your WhatsApp display name is managed by Meta."
        >
          <Input
            id="businessName"
            name="businessName"
            defaultValue={v.businessName}
            aria-invalid={!!state.fieldErrors?.businessName}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="timezone"
            label="Timezone"
            error={state.fieldErrors?.timezone}
            hint="Used for scheduling and reports."
          >
            <NativeSelect id="timezone" name="timezone" defaultValue={v.timezone ?? "UTC"}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="currency" label="Currency" error={state.fieldErrors?.currency}>
            <NativeSelect id="currency" name="currency" defaultValue={v.currency ?? "USD"}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <FormField
          id="defaultCountry"
          label="Default country for phone numbers"
          error={state.fieldErrors?.defaultCountry}
          hint="Used when a phone number is entered without a country code."
        >
          <NativeSelect id="defaultCountry" name="defaultCountry" defaultValue={v.defaultCountry ?? ""}>
            <option value="">None (always require +country code)</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (+{c.callingCode})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {variant === "settings" && (
          <FormField
            id="logoUrl"
            label="Logo URL"
            error={state.fieldErrors?.logoUrl}
            hint="Optional. An https:// link to a square image. File upload arrives with media storage."
          >
            <Input
              id="logoUrl"
              name="logoUrl"
              type="url"
              defaultValue={v.logoUrl ?? ""}
              aria-invalid={!!state.fieldErrors?.logoUrl}
            />
          </FormField>
        )}
      </fieldset>
      {!disabled && (
        <div>
          <SubmitButton pendingLabel="Saving…">
            {variant === "onboarding" ? "Save and continue" : "Save changes"}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
