"use client";

import { EntityFormDialog } from "@/components/app/entity-form-dialog";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveListAction } from "../actions";

export function ListDialog({
  slug,
  list,
  trigger,
}: {
  slug: string;
  list?: { id: string; name: string; description: string | null };
  trigger: React.ReactNode;
}) {
  return (
    <EntityFormDialog
      trigger={trigger}
      title={list ? "Edit list" : "New list"}
      description="Lists are fixed groups of contacts. Add contacts from the contacts table or during import."
      submitLabel={list ? "Save list" : "Create list"}
      action={saveListAction.bind(null, slug, list?.id ?? null)}
    >
      {(state) => (
        <>
          <FormField id="list-name" label="Name" error={state.fieldErrors?.name}>
            <Input
              id="list-name"
              name="name"
              defaultValue={state.values?.name ?? list?.name}
              aria-invalid={!!state.fieldErrors?.name}
              autoFocus
            />
          </FormField>
          <FormField id="list-description" label="Description" error={state.fieldErrors?.description}>
            <Textarea
              id="list-description"
              name="description"
              defaultValue={state.values?.description ?? list?.description ?? ""}
            />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
