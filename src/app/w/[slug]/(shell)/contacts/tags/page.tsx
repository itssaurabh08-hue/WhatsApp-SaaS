import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, TagIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { TagBadge } from "@/components/app/tag-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listTags } from "@/server/contacts/tags";
import { deleteTagAction } from "../actions";
import { TagDialog } from "./tag-dialog";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage({ params }: PageProps<"/w/[slug]/contacts/tags">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const tags = await listTags(ctx);
  const canWrite = can(ctx, "contacts:write");
  const canDelete = can(ctx, "contacts:delete");
  const newButton = canWrite ? (
    <TagDialog
      slug={slug}
      trigger={
        <Button>
          <PlusIcon />
          New tag
        </Button>
      }
    />
  ) : undefined;

  return (
    <>
      <PageHeader title="Tags" description="Labels for organizing and segmenting contacts." actions={newButton} />
      {tags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No tags yet."
          description="Tags help you segment contacts, for example Customer or VIP."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tag</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell className="pl-4">
                    <TagBadge name={tag.name} color={tag.color} />
                  </TableCell>
                  <TableCell>
                    <Link className="tabular-nums hover:underline" href={`/w/${slug}/contacts?tagId=${tag.id}`}>
                      {tag._count.contacts.toLocaleString("en-US")}
                    </Link>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <TagDialog
                          slug={slug}
                          tag={tag}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                        />
                      )}
                      {canDelete && (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="sm">
                              Delete
                            </Button>
                          }
                          title={`Delete tag "${tag.name}"?`}
                          description={`The tag is removed from ${tag._count.contacts.toLocaleString("en-US")} contact(s). The contacts themselves are kept.`}
                          confirmLabel="Delete tag"
                          action={deleteTagAction.bind(null, slug, tag.id)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
