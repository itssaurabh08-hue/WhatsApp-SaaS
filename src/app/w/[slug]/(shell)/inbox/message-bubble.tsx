import { AlertCircleIcon, CheckCheckIcon, CheckIcon, ClockIcon, FileIcon, MapPinIcon } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { MESSAGE_STATUS_LABELS } from "@/lib/messaging";
import { cn } from "@/lib/utils";

export interface BubbleMessage {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  payload: unknown;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  receivedAt: Date | null;
  sentBy: { name: string } | null;
  template: { name: string } | null;
  mediaObject: { id: string; mimeType: string; fileName: string | null; size: number | null; status: string } | null;
}

function StatusIcon({ status }: { status: string }) {
  const label = MESSAGE_STATUS_LABELS[status] ?? status;
  if (status === "FAILED") return <AlertCircleIcon className="text-destructive size-3.5" aria-label={label} />;
  if (status === "READ") return <CheckCheckIcon className="size-3.5 text-sky-500" aria-label={label} />;
  if (status === "DELIVERED") return <CheckCheckIcon className="size-3.5" aria-label={label} />;
  if (status === "SENT") return <CheckIcon className="size-3.5" aria-label={label} />;
  return <ClockIcon className="size-3.5" aria-label={label} />;
}

export function MessageBubble({ m, slug, timezone }: { m: BubbleMessage; slug: string; timezone: string }) {
  const outbound = m.direction === "OUTBOUND";
  const media = m.mediaObject;
  const mediaUrl = media ? `/w/${slug}/inbox/media/${media.id}` : null;
  const time = (m.receivedAt ?? m.createdAt).toLocaleString("en-US", {
    timeStyle: "short",
    dateStyle: "short",
    timeZone: timezone,
  });
  const payload = (m.payload ?? {}) as Record<string, unknown>;

  if (m.type === "reaction") {
    return (
      <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
        <p className="text-muted-foreground text-xs">
          {payload.removed ? "Removed a reaction" : `Reacted ${m.body ?? ""}`} · {time}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")} data-testid="message">
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-xs sm:max-w-[70%]",
          outbound ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-background border",
        )}
      >
        {m.template && <p className="text-muted-foreground mb-1 text-xs">Template: {m.template.name}</p>}
        {media && mediaUrl && (
          <div className="mb-1">
            {media.status !== "STORED" ? (
              <p className="text-muted-foreground text-xs italic">
                {media.status === "FAILED" ? "The file could not be downloaded from WhatsApp." : "Downloading file…"}
              </p>
            ) : media.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl} alt={m.body ?? "Image"} className="max-h-72 rounded-md" loading="lazy" />
            ) : media.mimeType.startsWith("video/") ? (
              <video src={mediaUrl} controls className="max-h-72 rounded-md" />
            ) : media.mimeType.startsWith("audio/") ? (
              <audio src={mediaUrl} controls />
            ) : (
              <a href={mediaUrl} className="flex items-center gap-2 underline underline-offset-4">
                <FileIcon className="size-4" aria-hidden />
                {media.fileName ?? "Document"} {media.size ? `(${formatBytes(media.size)})` : ""}
              </a>
            )}
          </div>
        )}
        {m.type === "location" && <MapPinIcon className="text-muted-foreground mr-1 inline size-4" aria-hidden />}
        {m.body ? (
          <p className="break-words whitespace-pre-wrap">{m.body}</p>
        ) : m.type === "unsupported" ? (
          <p className="text-muted-foreground italic">This message type is not supported by WhatsApp Cloud API.</p>
        ) : null}
        <div className="text-muted-foreground mt-1 flex items-center justify-end gap-1 text-[11px]">
          {outbound && m.sentBy && <span>{m.sentBy.name} ·</span>}
          <span>{time}</span>
          {outbound && <StatusIcon status={m.status} />}
        </div>
        {outbound && m.status === "FAILED" && m.errorMessage && (
          <p className="text-destructive mt-1 text-xs">{m.errorMessage}</p>
        )}
      </div>
    </div>
  );
}
