"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

interface Option {
  id: string;
  name: string;
}

/** Filters are kept in the URL so views are shareable and rendered server-side. */
export function ContactsFilters({ tags, lists, segments }: { tags: Option[]; lists: Option[]; segments: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("cursor");
    router.push(`${pathname}?${next.toString()}`);
  };

  const active = ["q", "tagId", "listId", "segmentId", "optInStatus"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="relative w-full sm:w-64"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q });
        }}
      >
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
        <Input
          aria-label="Search contacts"
          placeholder="Search name, phone, email"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <NativeSelect
        aria-label="Filter by tag"
        className="w-auto"
        value={params.get("tagId") ?? ""}
        onChange={(e) => update({ tagId: e.target.value })}
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Filter by list"
        className="w-auto"
        value={params.get("listId") ?? ""}
        onChange={(e) => update({ listId: e.target.value })}
      >
        <option value="">All lists</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </NativeSelect>
      {segments.length > 0 && (
        <NativeSelect
          aria-label="Filter by segment"
          className="w-auto"
          value={params.get("segmentId") ?? ""}
          onChange={(e) => update({ segmentId: e.target.value })}
        >
          <option value="">No segment</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      )}
      <NativeSelect
        aria-label="Filter by opt-in status"
        className="w-auto"
        value={params.get("optInStatus") ?? ""}
        onChange={(e) => update({ optInStatus: e.target.value })}
      >
        <option value="">Any opt-in status</option>
        <option value="OPTED_IN">Opted in</option>
        <option value="OPTED_OUT">Opted out</option>
        <option value="UNKNOWN">Unknown</option>
      </NativeSelect>
      <NativeSelect
        aria-label="Sort"
        className="w-auto"
        value={params.get("sort") ?? "newest"}
        onChange={(e) => update({ sort: e.target.value === "newest" ? "" : e.target.value })}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name">Name A-Z</option>
      </NativeSelect>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            router.push(pathname);
          }}
        >
          <XIcon />
          Clear filters
        </Button>
      )}
    </div>
  );
}
