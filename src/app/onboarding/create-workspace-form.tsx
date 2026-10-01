"use client";

import { useActionState, useState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { createWorkspaceAction } from "./actions";

export function CreateWorkspaceForm({ appHost }: { appHost: string }) {
  const [state, action] = useActionState(createWorkspaceAction, {});
  const [name, setName] = useState(state.values?.name ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.slug));
  const shownSlug = slugEdited ? slug : slugify(name);

  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="name"
        label="Workspace name"
        error={state.fieldErrors?.name}
        hint="Usually your company or team name."
      >
        <Input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!state.fieldErrors?.name}
          placeholder="Acme Inc."
        />
      </FormField>
      <FormField
        id="slug"
        label="Workspace URL"
        error={state.fieldErrors?.slug}
        hint={`${appHost}/w/${shownSlug || "your-workspace"}`}
      >
        {/* An unedited slug is left blank so the server can pick a unique one. */}
        <input type="hidden" name="slug" value={slugEdited ? slug : ""} />
        <Input
          id="slug"
          value={shownSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
          aria-invalid={!!state.fieldErrors?.slug}
          placeholder="acme"
        />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Creating workspace…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
