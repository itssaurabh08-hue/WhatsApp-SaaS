"use client";

import { EntityFormDialog } from "@/components/app/entity-form-dialog";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createCustomFieldAction } from "../actions";

export function FieldDialog({ slug, trigger }: { slug: string; trigger: React.ReactNode }) {
  return (
    <EntityFormDialog
      trigger={trigger}
      title="New custom field"
      description="Custom fields store extra information on contacts and can be used in segments and CSV imports."
      submitLabel="Create field"
      action={createCustomFieldAction.bind(null, slug)}
    >
      {(state) => (
        <>
          <FormField id="field-label" label="Label" error={state.fieldErrors?.label}>
            <Input id="field-label" name="label" defaultValue={state.values?.label} placeholder="City" autoFocus />
          </FormField>
          <FormField
            id="field-key"
            label="Key"
            error={state.fieldErrors?.key}
            hint="Lowercase letters, numbers and underscores. Cannot be changed later."
          >
            <Input id="field-key" name="key" defaultValue={state.values?.key} placeholder="city" />
          </FormField>
          <FormField id="field-type" label="Type" error={state.fieldErrors?.type}>
            <NativeSelect id="field-type" name="type" defaultValue={state.values?.type ?? "TEXT"}>
              <option value="TEXT">Text</option>
              <option value="NUMBER">Number</option>
              <option value="DATE">Date</option>
              <option value="BOOLEAN">Yes / No</option>
            </NativeSelect>
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
