import type { Metadata } from "next";
import Link from "next/link";
import { MegaphoneIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/campaigns";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCampaigns } from "@/server/campaigns/service";
import { STATUS_VARIANT } from "./status-variant";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({ params }: PageProps<"/w/[slug]/campaigns">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "campaigns:read")) return <NoAccess />;
  const campaigns = await listCampaigns(ctx);
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Send an approved template to a list, tag or segment."
        actions={
          can(ctx, "campaigns:manage") ? (
            <Button asChild>
              <Link href={`/w/${slug}/campaigns/new`}>
                <PlusIcon />
                New campaign
              </Link>
            </Button>
          ) : undefined
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No campaigns yet."
          description="Campaigns send an approved template to many contacts. Only contacts who have not opted out receive them."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Read</TableHead>
                <TableHead className="pr-4 text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link className="font-medium hover:underline" href={`/w/${slug}/campaigns/${c.id}`}>
                      {c.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">{c.template?.name ?? "Template deleted"}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(c.recipientCount - c.skippedCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(c.stats.delivered)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(c.stats.read)}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{n(c.stats.failed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
