import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquareIcon, PencilIcon, SendIcon, Trash2Icon, XIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { NoAccess } from "@/components/app/no-access";
import { OptInBadge } from "@/components/app/opt-in-badge";
import { PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { TagBadge } from "@/components/app/tag-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { contactDisplayName } from "@/lib/contacts/fields";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { getContact } from "@/server/contacts/service";
import { db } from "@/server/db/client";
import { listTags } from "@/server/contacts/tags";
import { isAppError } from "@/server/errors";
import {
  addContactTagAction,
  addNoteAction,
  deleteContactAction,
  deleteNoteAction,
  removeContactTagAction,
  setOptInAction,
} from "../actions";
import { NoteForm } from "./note-form";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: PageProps<"/w/[slug]/contacts/[id]">) {
  const { slug, id } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const contact = await getContact(ctx, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [allTags, customFields, conversation] = await Promise.all([
    listTags(ctx),
    listCustomFields(ctx),
    can(ctx, "inbox:read")
      ? db.conversation.findFirst({
          where: { workspaceId: ctx.workspaceId, contactId: id },
          orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const canWrite = can(ctx, "contacts:write");
  const canDelete = can(ctx, "contacts:delete");
  const custom = (contact.customFields ?? {}) as Record<string, string>;
  const assignedTagIds = new Set(contact.tags.map((t) => t.tag.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));
  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-US", { timeZone: ctx.workspace.timezone, dateStyle: "medium", timeStyle: "short" })
      : "None";
  const name = contactDisplayName(contact);

  return (
    <>
      <PageHeader
        title={name}
        description={contact.company ?? undefined}
        actions={
          <>
            {conversation && (
              <Button variant="outline" asChild>
                <Link href={`/w/${slug}/inbox?f=all&c=${conversation.id}`}>
                  <MessageSquareIcon />
                  Open conversation
                </Link>
              </Button>
            )}
            {can(ctx, "inbox:reply") && (
              <Button asChild>
                <Link href={`/w/${slug}/inbox/new?contactId=${id}`}>
                  <SendIcon />
                  Send WhatsApp message
                </Link>
              </Button>
            )}
            {canWrite && (
              <Button variant="outline" asChild>
                <Link href={`/w/${slug}/contacts/${id}/edit`}>
                  <PencilIcon />
                  Edit
                </Link>
              </Button>
            )}
            {canDelete && (
              <ConfirmAction
                trigger={
                  <Button variant="outline">
                    <Trash2Icon />
                    Delete
                  </Button>
                }
                title={`Delete ${name}?`}
                description="This permanently deletes the contact with its tags, list memberships and notes."
                confirmLabel="Delete contact"
                action={deleteContactAction.bind(null, slug, id)}
              />
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="tabular-nums">{contact.normalizedPhoneNumber}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{contact.email ?? "None"}</dd>
                <dt className="text-muted-foreground">Country</dt>
                <dd>{contact.country ?? "None"}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="capitalize">{contact.source.toLowerCase()}</dd>
                <dt className="text-muted-foreground">Added</dt>
                <dd>{fmt(contact.createdAt)}</dd>
                {customFields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd>
                      {custom[f.key] === "true" ? "Yes" : custom[f.key] === "false" ? "No" : (custom[f.key] ?? "None")}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conversation history</CardTitle>
              <CardDescription>
                Messages with this contact will appear here once WhatsApp messaging is available.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Campaign history</CardTitle>
              <CardDescription>
                Campaigns sent to this contact will appear here once campaigns are available.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
              <CardDescription>Visible to your team only. Never sent to the contact.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {canWrite && <NoteForm action={addNoteAction.bind(null, slug, id)} />}
              {contact.notes.length === 0 ? (
                <p className="text-muted-foreground text-sm">No notes yet.</p>
              ) : (
                <ul className="divide-y">
                  {contact.notes.map((note) => (
                    <li key={note.id} className="grid gap-1 py-3 text-sm">
                      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                        <span>
                          {note.author?.name ?? "Former member"} · {fmt(note.createdAt)}
                        </span>
                        {(note.authorId === ctx.user.id ? canWrite : canDelete) && (
                          <form action={deleteNoteAction.bind(null, slug, id, note.id)}>
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              aria-label="Delete note"
                            >
                              Delete
                            </Button>
                          </form>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{note.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp opt-in</CardTitle>
              <CardDescription>Marketing messages are never sent to opted-out contacts.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex items-center gap-2">
                <OptInBadge status={contact.optInStatus} />
                {contact.optInSource && <span className="text-muted-foreground">via {contact.optInSource}</span>}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Opted in</dt>
                <dd>{fmt(contact.optInAt)}</dd>
                <dt className="text-muted-foreground">Opted out</dt>
                <dd>{fmt(contact.optedOutAt)}</dd>
              </dl>
              {canWrite && (
                <form action={setOptInAction.bind(null, slug, id)} className="grid gap-2">
                  <label htmlFor="optInStatus" className="sr-only">
                    Opt-in status
                  </label>
                  <NativeSelect id="optInStatus" name="optInStatus" defaultValue={contact.optInStatus}>
                    <option value="OPTED_IN">Opted in</option>
                    <option value="OPTED_OUT">Opted out</option>
                    <option value="UNKNOWN">Unknown</option>
                  </NativeSelect>
                  <Input name="optInSource" aria-label="Opt-in source" placeholder="Source (optional)" />
                  <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                    Update opt-in
                  </SubmitButton>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.length === 0 && <span className="text-muted-foreground text-sm">No tags.</span>}
                {contact.tags.map(({ tag }) => (
                  <TagBadge key={tag.id} name={tag.name} color={tag.color}>
                    {canWrite && (
                      <form action={removeContactTagAction.bind(null, slug, id, tag.id)} className="inline-flex">
                        <button
                          type="submit"
                          aria-label={`Remove tag ${tag.name}`}
                          className="opacity-60 hover:opacity-100"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </form>
                    )}
                  </TagBadge>
                ))}
              </div>
              {canWrite && availableTags.length > 0 && (
                <form action={addContactTagAction.bind(null, slug, id)} className="flex gap-2">
                  <NativeSelect name="tagId" aria-label="Tag to add" className="h-8" defaultValue="">
                    <option value="" disabled>
                      Choose a tag
                    </option>
                    {availableTags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <SubmitButton size="sm" variant="outline">
                    Add
                  </SubmitButton>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lists</CardTitle>
            </CardHeader>
            <CardContent>
              {contact.lists.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Not in any list. Add contacts to lists from the contacts table.
                </p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {contact.lists.map(({ list }) => (
                    <li key={list.id}>
                      <Link className="hover:underline" href={`/w/${slug}/contacts?listId=${list.id}`}>
                        {list.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
