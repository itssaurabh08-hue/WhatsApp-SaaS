import type { Metadata } from "next";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlan, type PlanLimits } from "@/config/plans";
import { can, getTenantContext } from "@/server/authz/tenant";

export const metadata: Metadata = { title: "Billing" };

const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  contacts: "Contacts",
  members: "Team members",
  monthlyMessages: "Messages per month",
  monthlyCampaigns: "Campaigns per month",
  monthlyApiCalls: "API calls per month",
  storageMb: "Media storage (MB)",
  monthlyAutomationRuns: "Automation runs per month",
};

export default async function BillingPage({ params }: PageProps<"/w/[slug]/billing">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "billing:read")) return <NoAccess />;
  const plan = getPlan(ctx.workspace.planId);
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your subscription plan. WhatsApp conversation charges are billed by Meta separately and are not part of this subscription."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Current plan: {plan.name}</CardTitle>
          <CardDescription>Usage tracking and plan changes are coming in a later build.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            {(Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((key) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{LIMIT_LABELS[key]}</dt>
                <dd className="text-right tabular-nums">
                  {plan.limits[key] === null ? "Unlimited" : plan.limits[key]!.toLocaleString("en-US")}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
