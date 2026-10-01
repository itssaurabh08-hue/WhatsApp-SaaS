"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { segmentDefinitionSchema } from "@/lib/segments";
import {
  contactFilterSchema,
  contactInputSchema,
  customFieldInputSchema,
  listInputSchema,
  noteInputSchema,
  optInStatusSchema,
  tagInputSchema,
} from "@/lib/validation/contacts";
import { importMappingSchema, importOptionsSchema } from "@/lib/validation/imports";
import type { ColumnTarget } from "@/lib/contacts/fields";
import { actionError, fieldErrorsFrom, formValues } from "@/server/actions";
import { getTenantContext } from "@/server/authz/tenant";
import {
  bulkAddTag,
  bulkAddToList,
  bulkDelete,
  bulkRemoveFromList,
  bulkRemoveTag,
  type ContactSelection,
} from "@/server/contacts/bulk";
import { createCustomField, deleteCustomField } from "@/server/contacts/custom-fields";
import { createImportJob, previewImport, runImport, type ImportPreview } from "@/server/contacts/imports";
import { createContactList, deleteContactList, updateContactList } from "@/server/contacts/lists";
import { countSegment, createSegment, deleteSegment, updateSegment } from "@/server/contacts/segments";
import {
  addNote,
  createContact,
  deleteContact,
  deleteNote,
  setOptInStatus,
  updateContact,
} from "@/server/contacts/service";
import { addTagToContact, createTag, deleteTag, removeTagFromContact, updateTag } from "@/server/contacts/tags";
import { isAppError } from "@/server/errors";
import { getRequestMeta } from "@/server/request-meta";

const base = (slug: string) => `/w/${slug}/contacts`;

// ---------------------------------------------------------------------------
// Contact create / edit
// ---------------------------------------------------------------------------

type ContactFields =
  "phoneNumber" | "firstName" | "lastName" | "email" | "company" | "country" | "optInStatus" | "optInSource";
const CONTACT_KEYS = [
  "phoneNumber",
  "firstName",
  "lastName",
  "email",
  "company",
  "country",
  "optInStatus",
  "optInSource",
] as const;

function readContactForm(formData: FormData) {
  const values = formValues(formData, CONTACT_KEYS);
  const customFields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("custom.") && typeof value === "string") customFields[key.slice(7)] = value;
  }
  return { values, customFields };
}

export async function saveContactAction(
  slug: string,
  contactId: string | null,
  _prev: ActionState<ContactFields>,
  formData: FormData,
): Promise<ActionState<ContactFields>> {
  const ctx = await getTenantContext(slug);
  const { values, customFields } = readContactForm(formData);
  const parsed = contactInputSchema.safeParse({ ...values, customFields });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  let id = contactId;
  try {
    if (contactId) await updateContact(ctx, contactId, parsed.data, await getRequestMeta());
    else id = (await createContact(ctx, parsed.data)).id;
  } catch (error) {
    if (isAppError(error) && error.details?.field === "phoneNumber") {
      return { ok: false, fieldErrors: { phoneNumber: error.userMessage }, values };
    }
    return actionError(error, "save-contact", values);
  }
  revalidatePath(base(slug));
  redirect(`${base(slug)}/${id}`);
}

export async function deleteContactAction(slug: string, contactId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteContact(ctx, contactId, await getRequestMeta());
  revalidatePath(base(slug));
  redirect(base(slug));
}

export async function setOptInAction(slug: string, contactId: string, formData: FormData): Promise<void> {
  const ctx = await getTenantContext(slug);
  const status = optInStatusSchema.parse(formData.get("optInStatus"));
  const source = z
    .string()
    .trim()
    .max(120)
    .catch("")
    .parse(formData.get("optInSource") ?? "");
  await setOptInStatus(ctx, contactId, status, source || null, await getRequestMeta());
  revalidatePath(`${base(slug)}/${contactId}`);
}

export async function addContactTagAction(slug: string, contactId: string, formData: FormData): Promise<void> {
  const ctx = await getTenantContext(slug);
  const tagId = z.string().min(1).parse(formData.get("tagId"));
  await addTagToContact(ctx, contactId, tagId);
  revalidatePath(`${base(slug)}/${contactId}`);
}

export async function removeContactTagAction(slug: string, contactId: string, tagId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await removeTagFromContact(ctx, contactId, tagId);
  revalidatePath(`${base(slug)}/${contactId}`);
}

export async function addNoteAction(
  slug: string,
  contactId: string,
  _prev: ActionState<"body">,
  formData: FormData,
): Promise<ActionState<"body">> {
  const ctx = await getTenantContext(slug);
  const parsed = noteInputSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    await addNote(ctx, contactId, parsed.data.body);
  } catch (error) {
    return actionError(error, "add-note");
  }
  revalidatePath(`${base(slug)}/${contactId}`);
  return { ok: true };
}

export async function deleteNoteAction(slug: string, contactId: string, noteId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteNote(ctx, noteId);
  revalidatePath(`${base(slug)}/${contactId}`);
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

const selectionSchema = z.union([
  z.object({ ids: z.array(z.string().max(64)).min(1).max(1000) }),
  z.object({ filter: contactFilterSchema }),
]);

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addTag"), tagId: z.string().min(1) }),
  z.object({ action: z.literal("removeTag"), tagId: z.string().min(1) }),
  z.object({ action: z.literal("addToList"), listId: z.string().min(1) }),
  z.object({ action: z.literal("removeFromList"), listId: z.string().min(1) }),
  z.object({ action: z.literal("delete") }),
]);

export async function bulkContactsAction(
  slug: string,
  input: { selection: ContactSelection; operation: z.infer<typeof bulkSchema> },
): Promise<{ ok: boolean; message: string }> {
  const ctx = await getTenantContext(slug);
  const selection = selectionSchema.safeParse(input.selection);
  const op = bulkSchema.safeParse(input.operation);
  if (!selection.success || !op.success) return { ok: false, message: "Invalid request." };
  try {
    const sel = selection.data;
    const o = op.data;
    let message: string;
    switch (o.action) {
      case "addTag":
        message = `Tagged ${(await bulkAddTag(ctx, sel, o.tagId)).toLocaleString("en-US")} contact(s).`;
        break;
      case "removeTag":
        message = `Removed the tag from ${(await bulkRemoveTag(ctx, sel, o.tagId)).toLocaleString("en-US")} contact(s).`;
        break;
      case "addToList":
        message = `Added ${(await bulkAddToList(ctx, sel, o.listId)).toLocaleString("en-US")} contact(s) to the list.`;
        break;
      case "removeFromList":
        message = `Removed ${(await bulkRemoveFromList(ctx, sel, o.listId)).toLocaleString("en-US")} contact(s) from the list.`;
        break;
      case "delete":
        message = `Deleted ${(await bulkDelete(ctx, sel, await getRequestMeta())).toLocaleString("en-US")} contact(s).`;
        break;
    }
    revalidatePath(base(slug));
    return { ok: true, message };
  } catch (error) {
    const state = actionError(error, `bulk-${op.data.action}`);
    return { ok: false, message: state.message ?? "Something went wrong." };
  }
}

// ---------------------------------------------------------------------------
// Tags, lists, custom fields
// ---------------------------------------------------------------------------

export async function saveTagAction(
  slug: string,
  tagId: string | null,
  _prev: ActionState<"name" | "color">,
  formData: FormData,
): Promise<ActionState<"name" | "color">> {
  const ctx = await getTenantContext(slug);
  const values = formValues(formData, ["name", "color"] as const);
  const parsed = tagInputSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    if (tagId) await updateTag(ctx, tagId, parsed.data);
    else await createTag(ctx, parsed.data);
  } catch (error) {
    return actionError(error, "save-tag", values);
  }
  revalidatePath(`${base(slug)}/tags`);
  return { ok: true, message: tagId ? "Tag updated." : "Tag created." };
}

export async function deleteTagAction(slug: string, tagId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteTag(ctx, tagId, await getRequestMeta());
  revalidatePath(`${base(slug)}/tags`);
}

export async function saveListAction(
  slug: string,
  listId: string | null,
  _prev: ActionState<"name" | "description">,
  formData: FormData,
): Promise<ActionState<"name" | "description">> {
  const ctx = await getTenantContext(slug);
  const values = formValues(formData, ["name", "description"] as const);
  const parsed = listInputSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    if (listId) await updateContactList(ctx, listId, parsed.data);
    else await createContactList(ctx, parsed.data);
  } catch (error) {
    return actionError(error, "save-list", values);
  }
  revalidatePath(`${base(slug)}/lists`);
  return { ok: true, message: listId ? "List updated." : "List created." };
}

export async function deleteListAction(slug: string, listId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteContactList(ctx, listId);
  revalidatePath(`${base(slug)}/lists`);
}

type FieldFields = "label" | "key" | "type";
export async function createCustomFieldAction(
  slug: string,
  _prev: ActionState<FieldFields>,
  formData: FormData,
): Promise<ActionState<FieldFields>> {
  const ctx = await getTenantContext(slug);
  const values = formValues(formData, ["label", "key", "type"] as const);
  const parsed = customFieldInputSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    await createCustomField(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return actionError(error, "create-custom-field", values);
  }
  revalidatePath(`${base(slug)}/fields`);
  return { ok: true, message: "Custom field created." };
}

export async function deleteCustomFieldAction(slug: string, fieldId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteCustomField(ctx, fieldId, await getRequestMeta());
  revalidatePath(`${base(slug)}/fields`);
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const segmentFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : v)),
  definition: segmentDefinitionSchema,
});

export async function previewSegmentAction(
  slug: string,
  definition: unknown,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const ctx = await getTenantContext(slug);
  const parsed = segmentDefinitionSchema.safeParse(definition);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the conditions." };
  try {
    return { ok: true, count: await countSegment(ctx, parsed.data) };
  } catch (error) {
    return { ok: false, message: actionError(error, "preview-segment").message ?? "Could not count contacts." };
  }
}

export async function saveSegmentAction(
  slug: string,
  segmentId: string | null,
  input: { name: string; description: string; definition: unknown },
): Promise<{ ok: false; message: string } | undefined> {
  const ctx = await getTenantContext(slug);
  const parsed = segmentFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the segment." };
  let id = segmentId;
  try {
    if (segmentId) await updateSegment(ctx, segmentId, parsed.data, await getRequestMeta());
    else id = (await createSegment(ctx, parsed.data, await getRequestMeta())).id;
  } catch (error) {
    return { ok: false, message: actionError(error, "save-segment").message ?? "Could not save." };
  }
  revalidatePath(`${base(slug)}/segments`);
  redirect(`${base(slug)}?segmentId=${id}`);
}

export async function deleteSegmentAction(slug: string, segmentId: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  await deleteSegment(ctx, segmentId, await getRequestMeta());
  revalidatePath(`${base(slug)}/segments`);
  redirect(`${base(slug)}/segments`);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export async function uploadImportAction(
  slug: string,
  _prev: ActionState<"file">,
  formData: FormData,
): Promise<ActionState<"file">> {
  const ctx = await getTenantContext(slug);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: "Choose a CSV file." } };
  let jobId: string;
  try {
    const text = await file.text();
    jobId = (await createImportJob(ctx, { name: file.name, size: file.size, text })).id;
  } catch (error) {
    return actionError(error, "upload-import");
  }
  redirect(`${base(slug)}/import/${jobId}`);
}

const importRequestSchema = z.object({ mapping: importMappingSchema, options: importOptionsSchema });

export async function previewImportAction(
  slug: string,
  jobId: string,
  input: { mapping: ColumnTarget[]; options: unknown },
): Promise<{ ok: true; preview: ImportPreview } | { ok: false; message: string }> {
  const ctx = await getTenantContext(slug);
  const parsed = importRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the mapping." };
  try {
    return {
      ok: true,
      preview: await previewImport(ctx, jobId, parsed.data.mapping as ColumnTarget[], parsed.data.options),
    };
  } catch (error) {
    return { ok: false, message: actionError(error, "preview-import").message ?? "Could not validate the file." };
  }
}

export async function runImportAction(
  slug: string,
  jobId: string,
  input: { mapping: ColumnTarget[]; options: unknown },
): Promise<{ ok: false; message: string } | undefined> {
  const ctx = await getTenantContext(slug);
  const parsed = importRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the mapping." };
  try {
    await runImport(ctx, jobId, parsed.data.mapping as ColumnTarget[], parsed.data.options, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "run-import").message ?? "The import failed." };
  }
  revalidatePath(base(slug));
  redirect(`${base(slug)}/import/${jobId}`);
}
