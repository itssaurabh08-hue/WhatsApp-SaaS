import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlan } from "@/config/plans";
import { can, getTenantContext } from "@/server/authz/tenant";
import { getWorkspaceOverview } from "@/server/workspace/service";

export const metadata: Metadata = { title: "Dashboard" };

const STEP_ORDER = ["BUSINESS", "WHATSAPP", "CONTACTS", "TEMPLATES", "DONE"];

const ACTION_LABELS: Record<string, string> = {
  "workspace.created": "Workspace created",
  "workspace.settings_updated": "Settings updated",
  "workspace.member_invited": "Member invited",
  "workspace.member_removed": "Member removed",
  "workspace.member_role_changed": "Member role changed",
};

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  const overview = await getWorkspaceOverview(ctx);
  const plan = getPlan(ctx.workspace.planId);
  const stepIndex = STEP_ORDER.indexOf(ctx.workspace.onboardingStep);

  const checklist: { label: string; done: boolean; note?: string; href?: string }[] = [
    { label: "Create your workspace", done: true },
    { label: "Add business details", done: stepIndex > 0 },
    { label: "Connect a WhatsApp number", done: false, note: "Not available in this build yet" },
    { label: "Import contacts", done: (overview.contactCount ?? 0) > 0, href: `/w/${slug}/contacts/import` },
    { label: "Create or select an approved template", done: false, note: "Not available in this build yet" },
    { label: "Send your first campaign", done: false, note: "Not available in this build yet" },
  ];
  const canSetup = can(ctx, "workspace:update") && ctx.workspace.onboardingStep !== "DONE";

  return (
    <>
      <PageHeader
        title={`Welcome, ${ctx.user.name.split(" ")[0]}`}
        description={ctx.workspace.businessName ?? ctx.workspace.name}
        actions={
          canSetup ? (
            <Button asChild>
              <Link href={`/w/${slug}/setup`}>Continue setup</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>The shortest path from sign-up to your first campaign results.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-3 text-sm">
                  {item.done ? (
                    <CheckCircle2Icon className="text-success size-4" aria-label="Done" />
                  ) : (
                    <CircleIcon className="text-muted-foreground size-4" aria-label="Not done" />
                  )}
                  {item.href && !item.done ? (
                    <Link href={item.href} className="underline-offset-4 hover:underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
                  )}
                  {!item.done && item.note && <span className="text-muted-foreground text-xs">{item.note}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">WhatsApp</dt>
              <dd>
                <Badge variant="secondary">Not connected</Badge>
              </dd>
              {overview.contactCount !== null && (
                <>
                  <dt className="text-muted-foreground">Contacts</dt>
                  <dd>
                    <Link className="hover:underline" href={`/w/${slug}/contacts`}>
                      {overview.contactCount.toLocaleString("en-US")}
                    </Link>
                    {plan.limits.contacts !== null && (
                      <span className="text-muted-foreground"> of {plan.limits.contacts.toLocaleString("en-US")}</span>
                    )}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Plan</dt>
              <dd>{plan.name}</dd>
              <dt className="text-muted-foreground">Members</dt>
              <dd>
                {overview.memberCount}
                {plan.limits.members !== null && (
                  <span className="text-muted-foreground"> of {plan.limits.members}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="truncate">{ctx.workspace.timezone}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
      {overview.recentAudit && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Important changes made in this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recentAudit.length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {overview.recentAudit.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {ACTION_LABELS[entry.action] ?? entry.action}
                      {entry.actor && <span className="text-muted-foreground"> by {entry.actor.name}</span>}
                    </span>
                    <time className="text-muted-foreground" dateTime={entry.createdAt.toISOString()}>
                      {entry.createdAt.toLocaleString("en-US", {
                        timeZone: ctx.workspace.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
