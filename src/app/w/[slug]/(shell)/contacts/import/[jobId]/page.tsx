import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { suggestMapping } from "@/lib/contacts/fields";
import { listCountries } from "@/lib/phone";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { getImportJob } from "@/server/contacts/imports";
import { listContactLists } from "@/server/contacts/lists";
import { listTags } from "@/server/contacts/tags";
import { isAppError } from "@/server/errors";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportJobPage({ params }: PageProps<"/w/[slug]/contacts/import/[jobId]">) {
  const { slug, jobId } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:import")) return <NoAccess />;
  const job = await getImportJob(ctx, jobId).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  if (job.status === "UPLOADED" && job.sample) {
    const [customFields, tags, lists] = await Promise.all([
      listCustomFields(ctx),
      listTags(ctx),
      listContactLists(ctx),
    ]);
    return (
      <>
        <PageHeader
          title="Import contacts"
          description={`${job.fileName} · ${job.rowCount.toLocaleString("en-US")} rows`}
        />
        <ImportWizard
          slug={slug}
          jobId={job.id}
          headers={job.headers}
          sample={job.sample}
          warnings={job.warnings}
          rowCount={job.rowCount}
          suggested={suggestMapping(
            job.headers,
            customFields.map((f) => f.key),
          )}
          customFields={customFields.map((f) => ({ key: f.key, label: f.label }))}
          tags={tags.map((t) => ({ id: t.id, name: t.name }))}
          lists={lists.map((l) => ({ id: l.id, name: l.name }))}
          countries={listCountries()}
          defaultCountry={ctx.workspace.defaultCountry}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Import results" description={job.fileName} />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            {job.status === "COMPLETED"
              ? "Import completed"
              : job.status === "RUNNING"
                ? "Import in progress"
                : "Import failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {job.status === "FAILED" && (
            <Alert variant="destructive">
              <AlertDescription>
                The import stopped because of an error. Some contacts may have been imported. Upload the file again to
                retry; existing contacts are matched by phone number.
              </AlertDescription>
            </Alert>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="import-result">
            {[
              ["Created", job.createdCount],
              ["Updated", job.updatedCount],
              ["Skipped", job.skippedCount],
              ["Failed", job.failedCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{Number(value).toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/w/${slug}/contacts`}>View contacts</Link>
            </Button>
            {job.failedCount > 0 && (
              <Button variant="outline" asChild>
                <a href={`/w/${slug}/contacts/import/${job.id}/errors`}>
                  <DownloadIcon />
                  Download failed rows
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
