import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { NoAccess } from "@/components/app/no-access";
import { TemplatePreview } from "@/components/app/template-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/campaigns";
import { MESSAGE_STATUS_LABELS } from "@/lib/messaging";
import type { MetaTemplateComponent } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { can, getTenantContext } from "@/server/authz/tenant";
import { getCampaign, listRecipients, type RecipientFilter } from "@/server/campaigns/service";
import { orNotFound } from "@/server/pages";
import { LiveRefresh } from "../../inbox/live-refresh";
import { STATUS_VARIANT } from "../status-variant";
import { CampaignActions } from "./campaign-actions";

export const metadata: Metadata = { title: "Campaign" };

const FILTERS: { key: RecipientFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "replied", label: "Replied" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
  { key: "pending", label: "Waiting" },
];

export default async function CampaignPage({ params, searchParams }: PageProps<"/w/[slug]/campaigns/[id]">) {
  const { slug, id } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "campaigns:read")) return <NoAccess />;
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.r)?.key ?? "all") as RecipientFilter;
  const page = Math.max(1, Number(sp.page) || 1);
  const c = await orNotFound(getCampaign(ctx, id));
  const recipients = await listRecipients(ctx, id, filter, page);
  const s = c.stats;
  const sendable = c.recipientCount - c.skippedCount;
  const fmt = (d: Date | null) =>
    d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.workspace.timezone }) : null;
  const pct = (n: number) => (sendable > 0 ? `${Math.round((n / sendable) * 100)}%` : "");
  const tiles = [
    {
      label: "Recipients",
      value: c.recipientsReadyAt ? sendable : null,
      note: c.skippedCount ? `${c.skippedCount} skipped` : "",
    },
    { label: "Waiting / sending", value: s.pending + s.queued, note: "" },
    { label: "Sent", value: s.sent + s.accepted, note: s.accepted ? `${s.accepted} awaiting confirmation` : "" },
    { label: "Delivered", value: s.delivered, note: pct(s.delivered) },
    { label: "Read", value: s.read, note: pct(s.read) },
    { label: "Replied", value: s.replied, note: pct(s.replied) },
    { label: "Failed", value: s.failed, note: pct(s.failed) },
  ];
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { r: filter === "all" ? null : filter, page: page > 1 ? String(page) : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const str = q.toString();
    return `/w/${slug}/campaigns/${id}${str ? `?${str}` : ""}`;
  };

  return (
    <>
      {["SENDING", "SCHEDULED"].includes(c.status) && <LiveRefresh intervalMs={5000} />}
      <Link
        href={`/w/${slug}/campaigns`}
        className="text-muted-foreground mb-3 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Campaigns
      </Link>
      <PageHeader
        title={c.name}
        description={`${c.template?.name ?? "Template deleted"} from ${c.whatsappAccount.displayPhoneNumber ?? "your number"}`}
        actions={
          <CampaignActions
            slug={slug}
            id={c.id}
            status={c.status}
            canSend={can(ctx, "campaigns:send")}
            canManage={can(ctx, "campaigns:manage")}
            timezone={ctx.workspace.timezone}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={STATUS_VARIANT[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
        {c.status === "SCHEDULED" && <span>Starts {fmt(c.scheduledAt)}</span>}
        {c.startedAt && <span className="text-muted-foreground">Started {fmt(c.startedAt)}</span>}
        {c.completedAt && <span className="text-muted-foreground">Finished {fmt(c.completedAt)}</span>}
      </div>
      {c.statusDetail && (
        <Alert className="mb-4">
          <AlertDescription>{c.statusDetail}</AlertDescription>
        </Alert>
      )}
      {c.status === "DRAFT" && (
        <p className="text-muted-foreground mb-4 text-sm">
          The audience is counted when the campaign starts. Opted-out contacts are always excluded
          {c.template?.category === "MARKETING" && !c.includeUnknownOptIn
            ? ", and only opted-in contacts receive marketing"
            : ""}
          .{c.whatsappAccount.messagingLimit && ` Your number's messaging limit: ${c.whatsappAccount.messagingLimit}.`}
        </p>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="grid gap-0.5 p-4">
              <span className="text-muted-foreground text-xs">{t.label}</span>
              <span className="text-xl font-semibold tabular-nums">
                {t.value === null ? "–" : t.value.toLocaleString("en-US")}
              </span>
              {t.note && <span className="text-muted-foreground text-xs">{t.note}</span>}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-3">
          <nav aria-label="Recipient filter" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ r: f.key === "all" ? null : f.key, page: null })}
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
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Contact</TableHead>
                  <TableHead className="pr-4">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground p-6 text-center">
                      {c.recipientsReadyAt
                        ? "No recipients in this view."
                        : "Recipients are listed once the campaign starts."}
                    </TableCell>
                  </TableRow>
                )}
                {recipients.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4">
                      <Link className="hover:underline" href={`/w/${slug}/contacts/${r.contact.id}`}>
                        {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.phoneNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="pr-4 text-sm">
                      {r.status === "SKIPPED"
                        ? `Skipped: ${r.skipReason ?? ""}`
                        : r.status === "CANCELLED"
                          ? "Cancelled"
                          : r.status === "PENDING"
                            ? "Waiting"
                            : r.message
                              ? MESSAGE_STATUS_LABELS[r.message.status]
                              : "Queued"}
                      {r.message?.status === "FAILED" && r.message.errorMessage && (
                        <span className="text-destructive block text-xs">{r.message.errorMessage}</span>
                      )}
                      {r.repliedAt && <span className="text-muted-foreground block text-xs">Replied</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {recipients.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {recipients.pages} ({recipients.total.toLocaleString("en-US")} recipients)
              </span>
              <div className="flex gap-3">
                {page > 1 && (
                  <Link className="underline" href={href({ page: String(page - 1) })}>
                    Previous
                  </Link>
                )}
                {page < recipients.pages && (
                  <Link className="underline" href={href({ page: String(page + 1) })}>
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
        {c.template && (
          <aside className="grid content-start gap-2">
            <h2 className="text-sm font-medium">Template</h2>
            <TemplatePreview components={c.template.components as unknown as MetaTemplateComponent[]} />
          </aside>
        )}
      </div>
    </>
  );
}
