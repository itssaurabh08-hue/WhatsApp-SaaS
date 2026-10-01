import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listImportJobs } from "@/server/contacts/imports";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import contacts" };

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "destructive" | "warning" }> = {
  UPLOADED: { label: "Not imported yet", variant: "warning" },
  RUNNING: { label: "Importing", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
};

export default async function ImportPage({ params }: PageProps<"/w/[slug]/contacts/import">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:import")) return <NoAccess />;
  const jobs = await listImportJobs(ctx);
  return (
    <>
      <PageHeader
        title="Import contacts"
        description="Upload a CSV file, map its columns, review the preview, then import."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upload a file</CardTitle>
            <CardDescription>
              Each row needs a phone number. Include the country code (for example +91) or choose a default country in
              the next step.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm slug={slug} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Consent matters</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Only import people who agreed to receive WhatsApp messages from your business. You can record opt-in status
            from a column or set a default. Contacts who opted out stay opted out even if the file says otherwise.
          </CardContent>
        </Card>
      </div>
      {jobs.length > 0 && (
        <Card className="mt-4 py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="pr-5">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="max-w-56 truncate pl-5">
                      <Link className="hover:underline" href={`/w/${slug}/contacts/import/${j.id}`}>
                        {j.fileName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[j.status]!.variant}>{STATUS[j.status]!.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{j.rowCount.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.createdCount.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.updatedCount.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.failedCount.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-muted-foreground pr-5">
                      {j.createdAt.toLocaleString("en-US", {
                        timeZone: ctx.workspace.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {j.createdBy && ` by ${j.createdBy.name}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
