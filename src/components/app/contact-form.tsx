"use client";

import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionState } from "@/lib/action-state";

type Fields =
  "phoneNumber" | "firstName" | "lastName" | "email" | "company" | "country" | "optInStatus" | "optInSource";

interface CustomFieldDef {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
}

export function ContactForm({
  action,
  countries,
  customFields,
  defaults,
  customDefaults,
  submitLabel,
}: {
  action: (prev: ActionState<Fields>, formData: FormData) => Promise<ActionState<Fields>>;
  countries: { code: string; name: string; callingCode: string }[];
  customFields: CustomFieldDef[];
  defaults: Partial<Record<Fields, string>>;
  customDefaults: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = { ...defaults, ...state.values };
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {!state.ok && state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="phoneNumber"
          label="Phone number"
          error={err.phoneNumber}
          hint="Include the country code, e.g. +91 98123 45678, or choose a country."
        >
          <Input
            id="phoneNumber"
            name="phoneNumber"
            type="tel"
            autoComplete="off"
            defaultValue={v.phoneNumber}
            aria-invalid={!!err.phoneNumber}
            required
          />
        </FormField>
        <FormField id="country" label="Country" error={err.country}>
          <NativeSelect id="country" name="country" defaultValue={v.country ?? ""}>
            <option value="">Detect from number</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (+{c.callingCode})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="firstName" label="First name" error={err.firstName}>
          <Input id="firstName" name="firstName" defaultValue={v.firstName} />
        </FormField>
        <FormField id="lastName" label="Last name" error={err.lastName}>
          <Input id="lastName" name="lastName" defaultValue={v.lastName} />
        </FormField>
        <FormField id="email" label="Email" error={err.email}>
          <Input id="email" name="email" type="email" defaultValue={v.email} aria-invalid={!!err.email} />
        </FormField>
        <FormField id="company" label="Company" error={err.company}>
          <Input id="company" name="company" defaultValue={v.company} />
        </FormField>
        <FormField
          id="optInStatus"
          label="WhatsApp opt-in"
          error={err.optInStatus}
          hint="Only message contacts who agreed to hear from you."
        >
          <NativeSelect id="optInStatus" name="optInStatus" defaultValue={v.optInStatus ?? "UNKNOWN"}>
            <option value="UNKNOWN">Unknown</option>
            <option value="OPTED_IN">Opted in</option>
            <option value="OPTED_OUT">Opted out</option>
          </NativeSelect>
        </FormField>
        <FormField
          id="optInSource"
          label="Opt-in source"
          error={err.optInSource}
          hint="Where consent was given, e.g. website form."
        >
          <Input id="optInSource" name="optInSource" defaultValue={v.optInSource} />
        </FormField>
      </div>
      {customFields.length > 0 && (
        <fieldset className="grid gap-4">
          <legend className="mb-2 text-sm font-medium">Custom fields</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {customFields.map((f) => (
              <FormField key={f.key} id={`custom-${f.key}`} label={f.label}>
                {f.type === "BOOLEAN" ? (
                  <NativeSelect
                    id={`custom-${f.key}`}
                    name={`custom.${f.key}`}
                    defaultValue={customDefaults[f.key] ?? ""}
                  >
                    <option value="">Not set</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </NativeSelect>
                ) : (
                  <Input
                    id={`custom-${f.key}`}
                    name={`custom.${f.key}`}
                    type={f.type === "DATE" ? "date" : f.type === "NUMBER" ? "number" : "text"}
                    step={f.type === "NUMBER" ? "any" : undefined}
                    defaultValue={customDefaults[f.key] ?? ""}
                  />
                )}
              </FormField>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
