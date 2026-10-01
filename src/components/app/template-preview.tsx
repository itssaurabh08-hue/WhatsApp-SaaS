import { ExternalLinkIcon, FileIcon, ImageIcon, PhoneIcon, ReplyIcon, VideoIcon } from "lucide-react";
import { renderTemplate, type MetaTemplateComponent, type TemplateValues } from "@/lib/templates";
import { cn } from "@/lib/utils";

/** WhatsApp-style bubble preview of a template, with variables filled where values are given. */
export function TemplatePreview({
  components,
  values,
  className,
}: {
  components: MetaTemplateComponent[];
  values?: TemplateValues;
  className?: string;
}) {
  const r = renderTemplate(components, values);
  const buttons = components.find((c) => c.type.toUpperCase() === "BUTTONS")?.buttons ?? [];
  const MediaIcon = r.headerMedia === "VIDEO" ? VideoIcon : r.headerMedia === "DOCUMENT" ? FileIcon : ImageIcon;
  return (
    <div className={cn("rounded-lg bg-[#efeae2] p-4 dark:bg-zinc-900", className)}>
      <div className="max-w-sm overflow-hidden rounded-lg bg-white text-sm text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
        <div className="grid gap-1.5 p-3">
          {r.headerMedia && (
            <div className="flex h-28 items-center justify-center rounded-md bg-zinc-200 text-zinc-500 dark:bg-zinc-700">
              <MediaIcon className="size-6" aria-hidden />
              <span className="sr-only">{r.headerMedia.toLowerCase()} header</span>
            </div>
          )}
          {r.header && <p className="font-semibold">{r.header}</p>}
          <p className="break-words whitespace-pre-wrap">
            {r.body || <span className="text-zinc-400">Message body</span>}
          </p>
          {r.footer && <p className="text-xs text-zinc-500">{r.footer}</p>}
        </div>
        {buttons.length > 0 && (
          <div className="divide-y border-t dark:border-zinc-700">
            {buttons.map((b, i) => {
              const Icon = b.type === "URL" ? ExternalLinkIcon : b.type === "PHONE_NUMBER" ? PhoneIcon : ReplyIcon;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm text-sky-600 dark:text-sky-400"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {b.text ?? b.type}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
