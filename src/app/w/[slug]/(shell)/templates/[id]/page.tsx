import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { TemplatePreview } from "@/components/app/template-preview";
import { CATEGORY_LABELS, TemplateStatusBadge } from "@/components/app/template-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { templateRequirements, type MetaTemplateComponent } from "@/lib/templates";
import { can, getTenantContext } from "@/server/authz/tenant";
import { orNotFound } from "@/server/pages";
import { getTemplate } from "@/server/templates/service";
import { deleteTemplateAction } from "../actions";

export const metadata: Metadata = { title: "Template" };

const STATUS_HELP: Record<string, string> = {
  PENDING: "Meta is reviewing this template. Review can take up to 24 hours. The status updates here automatically.",
  REJECTED: "Meta rejected this template. Create a corrected version, or appeal in WhatsApp Manager.",
  PAUSED: "Meta paused this template because of customer feedback. It cannot be sent until it is unpaused.",
  DISABLED: "Meta disabled this template because of repeated negative feedback. It cannot be sent.",
  FLAGGED: "Meta flagged this template after negative feedback. It may be disabled soon.",
  APPROVED: "Approved. You can send this template.",
};

export default async function TemplatePage({ params, searchParams }: PageProps<"/w/[slug]/templates/[id]">) {
  const { slug, id } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "templates:read")) return <NoAccess />;
  const template = await orNotFound(getTemplate(ctx, id));
  const created = (await searchParams).created === "1";
  const components = template.components as unknown as MetaTemplateComponent[];
  const req = templateRequirements(components);
  const variables = [...req.header.map((v) => `header {{${v}}}`), ...req.body.map((v) => `{{${v}}}`)];

  return (
    <>
      <Link
        href={`/w/${slug}/templates`}
        className="text-muted-foreground mb-3 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Templates
      </Link>
      <PageHeader
        title={template.name}
        description={`${CATEGORY_LABELS[template.category] ?? template.category} template, ${template.language}`}
        actions={
          can(ctx, "templates:manage") ? (
            <ConfirmAction
              trigger={<Button variant="outline">Delete</Button>}
              title={`Delete template "${template.name}"?`}
              description="The template is deleted in WhatsApp too (this language only). Meta does not allow reusing the name of a deleted approved template for 30 days."
              confirmLabel="Delete template"
              action={deleteTemplateAction.bind(null, slug, template.id)}
            />
          ) : undefined
        }
      />
      {created && (
        <Alert className="mb-4">
          <AlertTitle>Submitted to Meta for review</AlertTitle>
          <AlertDescription>You will see the result here when Meta finishes reviewing it.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="flex items-center gap-2">
              <TemplateStatusBadge status={template.status} />
            </div>
            {STATUS_HELP[template.status] && <p className="text-muted-foreground">{STATUS_HELP[template.status]}</p>}
            {template.rejectionReason && (
              <Alert variant="destructive">
                <AlertTitle>Reason from Meta</AlertTitle>
                <AlertDescription>{template.rejectionReason}</AlertDescription>
              </Alert>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Variables</dt>
              <dd>{variables.length > 0 ? variables.join(", ") : "None"}</dd>
              <dt className="text-muted-foreground">Variable style</dt>
              <dd>{template.parameterFormat === "NAMED" ? "Named, like {{first_name}}" : "Numbered, like {{1}}"}</dd>
              {req.headerMedia && (
                <>
                  <dt className="text-muted-foreground">Header file</dt>
                  <dd>A {req.headerMedia.toLowerCase()} is attached when sending.</dd>
                </>
              )}
              {req.unsupported && (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd>Uses a {req.unsupported}, which this app cannot send yet.</dd>
                </>
              )}
              <dt className="text-muted-foreground">Meta template ID</dt>
              <dd className="font-mono text-xs">{template.providerTemplateId ?? "Not submitted"}</dd>
              <dt className="text-muted-foreground">Last updated from Meta</dt>
              <dd>
                {template.lastSyncedAt
                  ? template.lastSyncedAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: ctx.workspace.timezone,
                    })
                  : "Never"}
              </dd>
            </dl>
          </CardContent>
        </Card>
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">Preview</h2>
          <TemplatePreview components={components} />
        </div>
      </div>
    </>
  );
}
