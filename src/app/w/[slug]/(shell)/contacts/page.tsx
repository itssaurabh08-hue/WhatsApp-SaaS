import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, PlusIcon, UploadIcon, UsersRoundIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { CONTACT_SORTS, contactFilterSchema, type ContactSort } from "@/lib/validation/contacts";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listContactLists } from "@/server/contacts/lists";
import { listSegments } from "@/server/contacts/segments";
import { listContacts } from "@/server/contacts/service";
import { listTags } from "@/server/contacts/tags";
import { ContactsFilters } from "./contacts-filters";
import { ContactsTable } from "./contacts-table";

export const metadata: Metadata = { title: "Contacts" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ContactsPage({ params, searchParams }: PageProps<"/w/[slug]/contacts">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const sp = await searchParams;

  const filterParse = contactFilterSchema.safeParse({
    q: first(sp.q) || undefined,
    tagId: first(sp.tagId) || undefined,
    listId: first(sp.listId) || undefined,
    segmentId: first(sp.segmentId) || undefined,
    optInStatus: first(sp.optInStatus) || undefined,
  });
  const filter = filterParse.success ? filterParse.data : {};
  const sortParam = first(sp.sort);
  const sort: ContactSort = CONTACT_SORTS.includes(sortParam as ContactSort) ? (sortParam as ContactSort) : "newest";
  const cursor = first(sp.cursor) || undefined;

  const [result, tags, lists, segments] = await Promise.all([
    listContacts(ctx, { filter, sort, cursor }),
    listTags(ctx),
    listContactLists(ctx),
    listSegments(ctx),
  ]);
  const hasFilter = Object.values(filter).some(Boolean);

  const exportParams = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const nextParams = new URLSearchParams(
    Object.entries({ ...filter, sort: sort === "newest" ? "" : sort }).filter(([, v]) => v) as [string, string][],
  );
  if (result.nextCursor) nextParams.set("cursor", result.nextCursor);
  const firstPageParams = new URLSearchParams(nextParams);
  firstPageParams.delete("cursor");

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${result.total.toLocaleString("en-US")} ${hasFilter ? "matching " : ""}contact${result.total === 1 ? "" : "s"}`}
        actions={
          <>
            {can(ctx, "contacts:export") && result.total > 0 && (
              <Button variant="outline" asChild>
                <a href={`/w/${slug}/contacts/export?${exportParams.toString()}`}>
                  <DownloadIcon />
                  Export CSV
                </a>
              </Button>
            )}
            {can(ctx, "contacts:import") && (
              <Button variant="outline" asChild>
                <Link href={`/w/${slug}/contacts/import`}>
                  <UploadIcon />
                  Import
                </Link>
              </Button>
            )}
            {can(ctx, "contacts:write") && (
              <Button asChild>
                <Link href={`/w/${slug}/contacts/new`}>
                  <PlusIcon />
                  Add contact
                </Link>
              </Button>
            )}
          </>
        }
      />
      {result.total === 0 && !hasFilter ? (
        <EmptyState
          icon={UsersRoundIcon}
          title="Import your contacts to start messaging."
          description="Add contacts one by one or import a CSV file with their opt-in status."
          action={
            can(ctx, "contacts:import") ? (
              <Button asChild>
                <Link href={`/w/${slug}/contacts/import`}>Import contacts</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4">
          <ContactsFilters
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
            lists={lists.map((l) => ({ id: l.id, name: l.name }))}
            segments={segments.map((s) => ({ id: s.id, name: s.name }))}
          />
          {result.items.length === 0 ? (
            <EmptyState
              title="No contacts match these filters."
              description="Try a different search or clear the filters."
            />
          ) : (
            <ContactsTable
              key={JSON.stringify({ filter, sort, cursor })}
              slug={slug}
              rows={result.items.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
              total={result.total}
              filter={filter}
              tags={tags.map((t) => ({ id: t.id, name: t.name }))}
              lists={lists.map((l) => ({ id: l.id, name: l.name }))}
              canWrite={can(ctx, "contacts:write")}
              canDelete={can(ctx, "contacts:delete")}
              timezone={ctx.workspace.timezone}
            />
          )}
          <nav className="flex items-center justify-end gap-2" aria-label="Pagination">
            {cursor && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`?${firstPageParams.toString()}`}>First page</Link>
              </Button>
            )}
            {result.nextCursor && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`?${nextParams.toString()}`}>Next page</Link>
              </Button>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
