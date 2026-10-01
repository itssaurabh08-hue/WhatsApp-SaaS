"use client";

import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { CSV_MAX_BYTES, CSV_MAX_ROWS } from "@/lib/csv";
import { uploadImportAction } from "../actions";

export function UploadForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(uploadImportAction.bind(null, slug), {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      {!state.ok && state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="file"
        label="CSV file"
        error={state.fieldErrors?.file}
        hint={`Up to ${CSV_MAX_BYTES / 1024 / 1024} MB and ${CSV_MAX_ROWS.toLocaleString("en-US")} rows. The first row must contain column names.`}
      >
        <Input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-invalid={!!state.fieldErrors?.file}
        />
      </FormField>
      <div>
        <SubmitButton pendingLabel="Uploading…">Upload and continue</SubmitButton>
      </div>
    </form>
  );
}
