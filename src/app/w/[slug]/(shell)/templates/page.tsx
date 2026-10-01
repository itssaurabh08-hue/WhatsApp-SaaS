import type { Metadata } from "next";
import Link from "next/link";
import { FileTextIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { CATEGORY_LABELS, TemplateStatusBadge } from "@/components/app/template-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listTemplates, type TemplateTab } from "@/server/templates/service";
import { listWhatsAppAccounts } from "@/server/whatsapp/connection";
import { SyncTemplatesButton } from "./sync-button";

export const metadata: Metadata = { title: "Templates" };

const TABS: { key: TemplateTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "pending", label: "In review" },
  { key: "rejected", label: "Rejected" },
  { key: "inactive", label: "Paused or inactive" },
];

export default async function TemplatesPage({ params, searchParams }: PageProps<"/w/[slug]/templates">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "templates:read")) return <NoAccess />;
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "all") as TemplateTab;
  const canManage = can(ctx, "templates:manage");
  const [{ templates, tabCounts }, accounts] = await Promise.all([
    listTemplates(ctx, { tab }),
    can(ctx, "whatsapp:read") ? listWhatsAppAccounts(ctx) : Promise.resolve([]),
  ]);
  const connected = accounts
    .filter((a) => a.status === "CONNECTED")
    .map((a) => ({ id: a.id, label: a.displayPhoneNumber ?? a.phoneNumberId }));
  const total = Object.values(tabCounts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Templates"
        description="Pre-approved WhatsApp messages. Meta reviews each template before it can be sent."
        actions={
          canManage && connected.length > 0 ? (
            <>
              <SyncTemplatesButton slug={slug} accounts={connected} />
              <Button asChild>
                <Link href={`/w/${slug}/templates/new`}>
                  <PlusIcon />
                  New template
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />
      {connected.length === 0 && (
        <p className="text-muted-foreground mb-4 text-sm">
          Connect a WhatsApp number in{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/w/${slug}/settings/whatsapp`}>
            Settings &gt; WhatsApp
          </Link>{" "}
          to create and sync templates.
        </p>
      )}
      <nav aria-label="Template status" className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const count = t.key === "all" ? total : tabCounts[t.key as Exclude<TemplateTab, "all">];
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? `/w/${slug}/templates` : `/w/${slug}/templates?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                tab === t.key
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {t.label} <span className="tabular-nums">({count})</span>
            </Link>
          );
        })}
      </nav>
      {templates.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title={total === 0 ? "No templates yet." : "No templates in this view."}
          description={
            total === 0
              ? "Create a template, or sync the ones you already have in WhatsApp Manager. Templates are needed to start conversations and for campaigns."
              : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden pr-4 md:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-4 font-medium">
                    <Link className="hover:underline" href={`/w/${slug}/templates/${t.id}`}>
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>{CATEGORY_LABELS[t.category] ?? t.category}</TableCell>
                  <TableCell>{t.language}</TableCell>
                  <TableCell>
                    <TemplateStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden pr-4 md:table-cell">
                    {t.updatedAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: ctx.workspace.timezone })}
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
