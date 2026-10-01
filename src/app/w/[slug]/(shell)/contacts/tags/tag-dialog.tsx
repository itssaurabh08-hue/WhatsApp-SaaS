"use client";

import { EntityFormDialog } from "@/components/app/entity-form-dialog";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TAG_COLORS } from "@/lib/contacts/fields";
import { saveTagAction } from "../actions";

export function TagDialog({
  slug,
  tag,
  trigger,
}: {
  slug: string;
  tag?: { id: string; name: string; color: string };
  trigger: React.ReactNode;
}) {
  return (
    <EntityFormDialog
      trigger={trigger}
      title={tag ? "Edit tag" : "New tag"}
      submitLabel={tag ? "Save tag" : "Create tag"}
      action={saveTagAction.bind(null, slug, tag?.id ?? null)}
    >
      {(state) => (
        <>
          <FormField id="tag-name" label="Name" error={state.fieldErrors?.name}>
            <Input
              id="tag-name"
              name="name"
              defaultValue={state.values?.name ?? tag?.name}
              aria-invalid={!!state.fieldErrors?.name}
              autoFocus
            />
          </FormField>
          <FormField id="tag-color" label="Color" error={state.fieldErrors?.color}>
            <NativeSelect id="tag-color" name="color" defaultValue={state.values?.color ?? tag?.color ?? "gray"}>
              {TAG_COLORS.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
