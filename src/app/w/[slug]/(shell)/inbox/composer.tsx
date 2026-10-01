"use client";

import { PaperclipIcon, SendIcon, StickyNoteIcon, XIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { TemplateComposer, type ComposerTemplate } from "@/components/app/template-composer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes, MAX_UPLOAD_BYTES, UPLOADABLE_TYPES } from "@/lib/media";
import { cn } from "@/lib/utils";
import { addNoteAction, sendReplyAction } from "./actions";

type Tab = "reply" | "template" | "note";

export function Composer({
  slug,
  conversationId,
  windowOpen,
  windowLabel,
  canReply,
  templates,
  defaults,
  blockedReason,
}: {
  slug: string;
  conversationId: string;
  windowOpen: boolean;
  windowLabel: string;
  canReply: boolean;
  templates: ComposerTemplate[];
  defaults: Record<string, string>;
  blockedReason: string | null;
}) {
  const [tab, setTab] = useState<Tab>(windowOpen ? "reply" : "template");
  const tabs: { key: Tab; label: string }[] = [
    { key: "reply", label: "Reply" },
    { key: "template", label: "Template" },
    { key: "note", label: "Internal note" },
  ];
  if (!canReply) {
    return (
      <p className="text-muted-foreground border-t p-4 text-sm">Your role can read conversations but not reply.</p>
    );
  }
  return (
    <div className={cn("border-t", tab === "note" && "bg-amber-50 dark:bg-amber-950/30")}>
      <div role="tablist" aria-label="Composer" className="flex gap-1 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === t.key ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto self-center text-xs">{windowLabel}</span>
      </div>
      <div className="p-3">
        {tab === "reply" &&
          (blockedReason ? (
            <p className="text-destructive text-sm">{blockedReason}</p>
          ) : windowOpen ? (
            <ReplyForm slug={slug} conversationId={conversationId} />
          ) : (
            <p className="text-muted-foreground text-sm">
              More than 24 hours have passed since the customer last wrote. WhatsApp only allows approved templates
              until they reply.{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-4"
                onClick={() => setTab("template")}
              >
                Send a template
              </button>
            </p>
          ))}
        {tab === "template" && (
          <TemplateComposer
            templates={templates}
            defaults={defaults}
            disabledReason={blockedReason}
            submit={async (fd) => {
              fd.set("kind", "template");
              return sendReplyAction(slug, conversationId, fd);
            }}
          />
        )}
        {tab === "note" && <NoteForm slug={slug} conversationId={conversationId} />}
      </div>
    </div>
  );
}

function ReplyForm({ slug, conversationId }: { slug: string; conversationId: string }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const send = () =>
    start(async () => {
      if (!text.trim() && !file) return;
      if (file && file.size > MAX_UPLOAD_BYTES) {
        toast.error(`Files can be at most ${formatBytes(MAX_UPLOAD_BYTES)}.`);
        return;
      }
      const fd = new FormData();
      fd.set("kind", file ? "media" : "text");
      fd.set("text", text);
      fd.set("idempotencyKey", key);
      if (file) fd.set("file", file);
      const r = await sendReplyAction(slug, conversationId, fd);
      if (!r.ok) {
        toast.error(r.message ?? "Sending failed.");
        return;
      }
      setText("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setKey(crypto.randomUUID());
    });

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {file && (
        <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <PaperclipIcon className="size-4" aria-hidden />
          <span className="truncate">{file.name}</span>
          <span className="text-muted-foreground">{formatBytes(file.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            aria-label="Remove file"
            onClick={() => setFile(null)}
          >
            <XIcon />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          id={`attach-${conversationId}`}
          accept={UPLOADABLE_TYPES.join(",")}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach file"
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Textarea
          aria-label={file ? "Caption" : "Message"}
          placeholder={file ? "Add a caption (optional)" : "Type a message"}
          rows={2}
          maxLength={file ? 1024 : 4096}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="min-h-10 resize-none"
        />
        <Button type="submit" disabled={pending || (!text.trim() && !file)} aria-label="Send">
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}

function NoteForm({ slug, conversationId }: { slug: string; conversationId: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const fd = new FormData();
          fd.set("note", note);
          const r = await addNoteAction(slug, conversationId, fd);
          if (!r.ok) toast.error(r.message ?? "Could not add the note.");
          else {
            toast.success(r.message ?? "Note added.");
            setNote("");
          }
        });
      }}
    >
      <Textarea
        aria-label="Internal note"
        placeholder="Visible to your team only. Never sent to the customer."
        rows={2}
        maxLength={5000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-10 resize-none bg-white dark:bg-transparent"
      />
      <Button type="submit" variant="outline" disabled={pending || !note.trim()}>
        <StickyNoteIcon />
        Add note
      </Button>
    </form>
  );
}
