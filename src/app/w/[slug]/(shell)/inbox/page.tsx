import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, InboxIcon, MessageSquarePlusIcon, SearchIcon, StickyNoteIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { OptInBadge } from "@/components/app/opt-in-badge";
import { TagBadge } from "@/components/app/tag-badge";
import type { ComposerTemplate } from "@/components/app/template-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isWindowOpen, windowRemaining } from "@/lib/messaging";
import type { MetaTemplateComponent } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { can, getTenantContext } from "@/server/authz/tenant";
import {
  getConversation,
  listAssignableMembers,
  listConversationNotes,
  listConversations,
  listMessages,
  markConversationRead,
  type InboxFilter,
} from "@/server/inbox/service";
import { orNotFound } from "@/server/pages";
import { listSendableTemplates } from "@/server/templates/service";
import { Composer } from "./composer";
import { ConversationControls } from "./conversation-controls";
import { LiveRefresh } from "./live-refresh";
import { MessageBubble } from "./message-bubble";
import { ScrollToBottom } from "./scroll-to-bottom";

export const metadata: Metadata = { title: "Inbox" };

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

function contactName(c: { firstName: string | null; lastName: string | null; phoneNumber: string }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.phoneNumber;
}

export default async function InboxPage({ params, searchParams }: PageProps<"/w/[slug]/inbox">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "inbox:read")) return <NoAccess />;
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.f)?.key ?? "open") as InboxFilter;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const selectedId = typeof sp.c === "string" ? sp.c : null;

  const conversations = await listConversations(ctx, { filter, q });
  const selected = selectedId ? await orNotFound(getConversation(ctx, selectedId)) : null;
  if (selected && selected.unreadCount > 0) await markConversationRead(ctx, selected.id);

  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { f: filter === "open" ? null : filter, q: q || null, c: selectedId, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/w/${slug}/inbox${s ? `?${s}` : ""}`;
  };

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] min-h-[480px] lg:-mx-8">
      <LiveRefresh />
      <section
        aria-label="Conversations"
        className={cn("flex w-full flex-col border-r md:w-80 md:shrink-0", selected && "hidden md:flex")}
      >
        <div className="grid gap-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Inbox</h1>
            {can(ctx, "inbox:reply") && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/w/${slug}/inbox/new`}>
                  <MessageSquarePlusIcon />
                  New
                </Link>
              </Button>
            )}
          </div>
          <form action={`/w/${slug}/inbox`} className="relative">
            {filter !== "open" && <input type="hidden" name="f" value={filter} />}
            <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search name or number"
              aria-label="Search conversations"
              className="pl-8"
            />
          </form>
          <nav aria-label="Filter" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={qs({ f: f.key === "open" ? null : f.key, c: null })}
                aria-current={filter === f.key ? "page" : undefined}
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  filter === f.key
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {conversations.length === 0 && (
            <li className="text-muted-foreground p-6 text-center text-sm">
              {q ? "No conversations match your search." : "No conversations here yet."}
            </li>
          )}
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={qs({ c: c.id })}
                aria-current={c.id === selectedId ? "true" : undefined}
                className={cn("hover:bg-muted/60 grid gap-0.5 px-3 py-2.5", c.id === selectedId && "bg-muted")}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-sm", c.unreadCount > 0 && "font-semibold")}>
                    {contactName(c.contact)}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
                    {c.lastMessageAt?.toLocaleString("en-US", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: ctx.workspace.timezone,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground truncate text-xs">{c.lastMessagePreview}</span>
                  {c.unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-[10px] font-medium tabular-nums">
                      <span className="sr-only">Unread: </span>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                {c.assignedUser && (
                  <span className="text-muted-foreground text-[11px]">Assigned to {c.assignedUser.name}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <Thread slug={slug} ctx={ctx} conversation={selected} backHref={qs({ c: null })} />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 md:flex">
          <EmptyState
            icon={InboxIcon}
            title="Select a conversation"
            description="Customer messages to your WhatsApp number appear here. Replies inside 24 hours of the customer's last message can be free text; after that, use an approved template."
          />
        </div>
      )}
    </div>
  );
}

async function Thread({
  slug,
  ctx,
  conversation,
  backHref,
}: {
  slug: string;
  ctx: Awaited<ReturnType<typeof getTenantContext>>;
  conversation: Awaited<ReturnType<typeof getConversation>>;
  backHref: string;
}) {
  const [messages, notes, members, templates] = await Promise.all([
    listMessages(ctx, conversation.id),
    listConversationNotes(ctx, conversation.id),
    listAssignableMembers(ctx),
    can(ctx, "templates:read") ? listSendableTemplates(ctx, conversation.whatsappAccount.id) : Promise.resolve([]),
  ]);
  const contact = conversation.contact;
  const open = isWindowOpen(conversation.lastInboundAt);
  const remaining = windowRemaining(conversation.lastInboundAt);
  const windowLabel = open ? `Reply window: ${remaining} left` : "Reply window closed";
  const accountBlocked =
    conversation.whatsappAccount.status !== "CONNECTED"
      ? "This WhatsApp number is not connected. Check Settings > WhatsApp."
      : !ctx.user.emailVerifiedAt
        ? "Verify your email address before sending messages."
        : null;
  const composerTemplates: ComposerTemplate[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    components: t.components as unknown as MetaTemplateComponent[],
  }));
  const defaults: Record<string, string> = {};
  if (contact.firstName) {
    defaults["1"] = contact.firstName;
    defaults.first_name = contact.firstName;
    defaults.name = contact.firstName;
  }

  const details = (
    <>
      <div className="grid gap-1">
        <h2 className="font-medium">{contactName(contact)}</h2>
        <p className="text-muted-foreground text-sm">{contact.phoneNumber}</p>
        {contact.email && <p className="text-muted-foreground text-sm">{contact.email}</p>}
        {contact.company && <p className="text-muted-foreground text-sm">{contact.company}</p>}
        <div className="mt-1 flex flex-wrap gap-1">
          <OptInBadge status={contact.optInStatus} />
          {contact.tags.map(({ tag }) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>
        {can(ctx, "contacts:read") && (
          <Link className="mt-1 text-sm underline underline-offset-4" href={`/w/${slug}/contacts/${contact.id}`}>
            View contact
          </Link>
        )}
      </div>
      <ConversationControls
        slug={slug}
        conversationId={conversation.id}
        status={conversation.status}
        assignedUserId={conversation.assignedUserId}
        members={members}
        canAssign={can(ctx, "inbox:assign")}
        canReply={can(ctx, "inbox:reply")}
      />
      <div className="grid gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <StickyNoteIcon className="size-4" aria-hidden />
          Internal notes
        </h3>
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes. Notes are visible to your team only.</p>
        ) : (
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/30">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {n.author?.name ?? "Former member"} ·{" "}
                  {n.createdAt.toLocaleString("en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: ctx.workspace.timezone,
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <>
      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <Link href={backHref} className="md:hidden" aria-label="Back to conversations">
            <ArrowLeftIcon className="size-5" />
          </Link>
          <div className="min-w-0">
            <h2 className="truncate font-medium">{contactName(contact)}</h2>
            <p className="text-muted-foreground text-xs">
              {contact.phoneNumber} via {conversation.whatsappAccount.displayPhoneNumber}
            </p>
          </div>
          <Badge variant={open ? "success" : "secondary"} className="ml-auto">
            {open ? `Window open, ${remaining}` : "Window closed"}
          </Badge>
        </header>
        <details className="border-b px-4 py-2 xl:hidden">
          <summary className="cursor-pointer text-sm">Contact, assignment and notes ({notes.length})</summary>
          <div className="grid gap-5 py-3">{details}</div>
        </details>
        <div className="bg-muted/30 flex-1 space-y-2 overflow-y-auto p-4" id="thread">
          <ScrollToBottom targetId="thread" count={messages.length} />
          {messages.length === 0 && <p className="text-muted-foreground text-center text-sm">No messages yet.</p>}
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} slug={slug} timezone={ctx.workspace.timezone} />
          ))}
        </div>
        <Composer
          key={conversation.id}
          slug={slug}
          conversationId={conversation.id}
          windowOpen={open}
          windowLabel={windowLabel}
          canReply={can(ctx, "inbox:reply")}
          templates={composerTemplates}
          defaults={defaults}
          blockedReason={accountBlocked}
        />
      </section>
      <aside
        aria-label="Contact details"
        className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l p-4 xl:flex"
      >
        {details}
      </aside>
    </>
  );
}
