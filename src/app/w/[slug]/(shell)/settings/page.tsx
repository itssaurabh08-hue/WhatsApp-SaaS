import type { Metadata } from "next";
import { BusinessDetailsForm } from "@/components/app/business-details-form";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listTimezones } from "@/lib/timezones";
import { can, getTenantContext } from "@/server/authz/tenant";
import { saveWorkspaceSettingsAction } from "../../actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  const editable = can(ctx, "workspace:update");
  return (
    <>
      <PageHeader title="Settings" description="Workspace and business settings." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Business</CardTitle>
          <CardDescription>
            {editable ? "Changes are recorded in the audit log." : "Only owners and admins can change these settings."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessDetailsForm
            variant="settings"
            disabled={!editable}
            action={saveWorkspaceSettingsAction.bind(null, slug)}
            timezones={listTimezones(ctx.workspace.timezone)}
            defaults={{
              name: ctx.workspace.name,
              businessName: ctx.workspace.businessName ?? "",
              timezone: ctx.workspace.timezone,
              currency: ctx.workspace.currency,
              logoUrl: ctx.workspace.logoUrl ?? "",
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
