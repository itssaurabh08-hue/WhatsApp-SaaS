"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { OptInBadge } from "@/components/app/opt-in-badge";
import { TagBadge } from "@/components/app/tag-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contactDisplayName } from "@/lib/contacts/fields";
import type { ContactFilter } from "@/lib/validation/contacts";
import { bulkContactsAction } from "./actions";

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  normalizedPhoneNumber: string;
  email: string | null;
  company: string | null;
  optInStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  createdAt: string;
  tags: { tag: { id: string; name: string; color: string } }[];
}

interface Option {
  id: string;
  name: string;
}

type Operation =
  | { action: "addTag"; tagId: string }
  | { action: "removeTag"; tagId: string }
  | { action: "addToList"; listId: string }
  | { action: "removeFromList"; listId: string }
  | { action: "delete" };

export function ContactsTable({
  slug,
  rows,
  total,
  filter,
  tags,
  lists,
  canWrite,
  canDelete,
  timezone,
}: {
  slug: string;
  rows: Row[];
  total: number;
  filter: ContactFilter;
  tags: Option[];
  lists: Option[];
  canWrite: boolean;
  canDelete: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const count = allMatching ? total : selected.size;
  const selectable = canWrite || canDelete;

  const toggle = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = (operation: Operation) =>
    start(async () => {
      const selection = allMatching ? { filter } : { ids: [...selected] };
      const result = await bulkContactsAction(slug, { selection, operation });
      if (result.ok) {
        toast.success(result.message);
        setSelected(new Set());
        setAllMatching(false);
        setConfirmDelete(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });

  return (
    <div className="grid gap-3">
      {selectable && count > 0 && (
        <div
          className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="font-medium">{count.toLocaleString("en-US")} selected</span>
          {allOnPage && !allMatching && total > rows.length && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setAllMatching(true)}>
              Select all {total.toLocaleString("en-US")} matching contacts
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canWrite && tags.length > 0 && (
              <>
                <NativeSelect
                  aria-label="Add tag"
                  className="h-8 w-auto"
                  value=""
                  disabled={pending}
                  onChange={(e) => e.target.value && run({ action: "addTag", tagId: e.target.value })}
                >
                  <option value="">Add tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Remove tag"
                  className="h-8 w-auto"
                  value=""
                  disabled={pending}
                  onChange={(e) => e.target.value && run({ action: "removeTag", tagId: e.target.value })}
                >
                  <option value="">Remove tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
            {canWrite && lists.length > 0 && (
              <NativeSelect
                aria-label="Add to list"
                className="h-8 w-auto"
                value=""
                disabled={pending}
                onChange={(e) => e.target.value && run({ action: "addToList", listId: e.target.value })}
              >
                <option value="">Add to list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            {canWrite && filter.listId && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run({ action: "removeFromList", listId: filter.listId! })}
              >
                Remove from this list
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="accent-foreground size-4"
                    checked={allOnPage}
                    onChange={() => {
                      setAllMatching(false);
                      setSelected(allOnPage ? new Set() : new Set(pageIds));
                    }}
                  />
                </TableHead>
              )}
              <TableHead className={selectable ? undefined : "pl-4"}>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Opt-in</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} data-state={selected.has(c.id) || allMatching ? "selected" : undefined}>
                {selectable && (
                  <TableCell className="pl-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${contactDisplayName(c)}`}
                      className="accent-foreground size-4"
                      checked={allMatching || selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                  </TableCell>
                )}
                <TableCell className={selectable ? "font-medium" : "pl-4 font-medium"}>
                  <Link href={`/w/${slug}/contacts/${c.id}`} className="hover:underline">
                    {contactDisplayName(c)}
                  </Link>
                  {c.company && <div className="text-muted-foreground text-xs font-normal">{c.company}</div>}
                </TableCell>
                <TableCell className="tabular-nums">{c.normalizedPhoneNumber}</TableCell>
                <TableCell className="hidden max-w-56 truncate md:table-cell">{c.email}</TableCell>
                <TableCell>
                  <div className="flex max-w-64 flex-wrap gap-1">
                    {c.tags.slice(0, 3).map(({ tag }) => (
                      <TagBadge key={tag.id} name={tag.name} color={tag.color} />
                    ))}
                    {c.tags.length > 3 && <span className="text-muted-foreground text-xs">+{c.tags.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <OptInBadge status={c.optInStatus} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden pr-4 lg:table-cell">
                  {new Date(c.createdAt).toLocaleDateString("en-US", { timeZone: timezone, dateStyle: "medium" })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {count.toLocaleString("en-US")} contact(s)?</DialogTitle>
            <DialogDescription>
              This permanently deletes the contacts with their tags, list memberships and notes. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => run({ action: "delete" })}>
              Delete contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
