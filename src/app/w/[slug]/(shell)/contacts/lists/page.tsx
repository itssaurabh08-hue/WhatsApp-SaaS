import type { Metadata } from "next";
import Link from "next/link";
import { ListIcon, PlusIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listContactLists } from "@/server/contacts/lists";
import { deleteListAction } from "../actions";
import { ListDialog } from "./list-dialog";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage({ params }: PageProps<"/w/[slug]/contacts/lists">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const lists = await listContactLists(ctx);
  const canWrite = can(ctx, "contacts:write");
  const canDelete = can(ctx, "contacts:delete");

  return (
    <>
      <PageHeader
        title="Lists"
        description="Fixed groups of contacts, for example event attendees."
        actions={
          canWrite ? (
            <ListDialog
              slug={slug}
              trigger={
                <Button>
                  <PlusIcon />
                  New list
                </Button>
              }
            />
          ) : undefined
        }
      />
      {lists.length === 0 ? (
        <EmptyState icon={ListIcon} title="No lists yet." description="Lists let you group contacts for campaigns." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">List</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id}>
                  <TableCell className="pl-4">
                    <Link className="font-medium hover:underline" href={`/w/${slug}/contacts?listId=${list.id}`}>
                      {list.name}
                    </Link>
                    {list.description && (
                      <div className="text-muted-foreground max-w-md truncate text-xs">{list.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{list._count.members.toLocaleString("en-US")}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <ListDialog
                          slug={slug}
                          list={list}
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
                          title={`Delete list "${list.name}"?`}
                          description="The list is deleted. Contacts in it are kept."
                          confirmLabel="Delete list"
                          action={deleteListAction.bind(null, slug, list.id)}
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
