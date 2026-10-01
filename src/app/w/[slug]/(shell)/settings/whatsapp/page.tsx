import type { Metadata } from "next";
import { ExternalLinkIcon } from "lucide-react";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { brand } from "@/config/brand";
import { ACCOUNT_STATUS, formatMessagingLimit, formatQuality } from "@/lib/whatsapp-display";
import { can, getTenantContext } from "@/server/authz/tenant";
import { getPlatformConfig } from "@/server/providers/whatsapp";
import { listWhatsAppAccounts } from "@/server/whatsapp/connection";
import { AccountActions } from "./account-actions";
import { Connect } from "./connect";

export const metadata: Metadata = { title: "WhatsApp settings" };

const WHATSAPP_MANAGER = "https://business.facebook.com/wa/manage/home/";

export default async function WhatsAppSettingsPage({ params }: PageProps<"/w/[slug]/settings/whatsapp">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "whatsapp:read")) return <NoAccess />;
  const accounts = await listWhatsAppAccounts(ctx);
  const config = getPlatformConfig();
  const canManage = can(ctx, "whatsapp:manage");
  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-US", { timeZone: ctx.workspace.timezone, dateStyle: "medium", timeStyle: "short" })
      : "Never";

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Your WhatsApp Business numbers connected through Meta's official WhatsApp Business Platform."
      />
      <div className="grid max-w-3xl gap-4">
        {accounts.map((a) => {
          const status = ACCOUNT_STATUS[a.status] ?? { label: a.status, tone: "secondary" as const };
          const quality = formatQuality(a.qualityRating);
          return (
            <Card key={a.id} data-testid="whatsapp-account">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{a.verifiedName ?? "WhatsApp number"}</CardTitle>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </div>
                <CardDescription className="tabular-nums">{a.displayPhoneNumber ?? a.phoneNumberId}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {a.statusDetail && (
                  <Alert variant={a.status === "CONNECTED" ? "default" : "destructive"}>
                    <AlertDescription>{a.statusDetail}</AlertDescription>
                  </Alert>
                )}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
                  <dt className="text-muted-foreground">Quality rating</dt>
                  <dd>
                    <Badge variant={quality.tone}>{quality.label}</Badge>
                  </dd>
                  <dt className="text-muted-foreground">Messaging limit</dt>
                  <dd>{formatMessagingLimit(a.messagingLimit)}</dd>
                  <dt className="text-muted-foreground">Display name status</dt>
                  <dd>{a.nameStatus?.replace(/_/g, " ").toLowerCase() ?? "Unknown"}</dd>
                  <dt className="text-muted-foreground">Webhooks</dt>
                  <dd>{a.webhooksSubscribedAt ? "Subscribed" : "Not subscribed yet"}</dd>
                  <dt className="text-muted-foreground">Registered for Cloud API</dt>
                  <dd>{a.registeredAt ? "Yes" : "Not yet"}</dd>
                  <dt className="text-muted-foreground">Last refreshed</dt>
                  <dd>{fmt(a.lastSyncedAt)}</dd>
                </dl>
                {canManage && <AccountActions slug={slug} accountId={a.id} status={a.status} />}
                {canManage && a.status === "NEEDS_RECONNECT" && config && (
                  <Connect
                    slug={slug}
                    appId={config.appId}
                    configId={config.configId}
                    apiVersion={config.apiVersion}
                    label="Reconnect with Facebook"
                  />
                )}
              </CardContent>
            </Card>
          );
        })}

        {accounts.some((a) => a.status === "CONNECTED") && (
          <Alert>
            <AlertTitle>Add a payment method in Meta</AlertTitle>
            <AlertDescription>
              <p>
                Meta bills WhatsApp messages directly. Before you can send template messages, add a payment method to
                your WhatsApp Business account in WhatsApp Manager.{" "}
                <a
                  className="inline-flex items-center gap-1 underline"
                  href={WHATSAPP_MANAGER}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open WhatsApp Manager <ExternalLinkIcon className="size-3" />
                </a>
              </p>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {accounts.length > 0 ? "Connect another number" : "Connect your WhatsApp Business number"}
            </CardTitle>
            <CardDescription>
              A Facebook window opens where you sign in, choose or create your business and WhatsApp Business account,
              and verify the phone number by SMS or call. It takes about 5 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>Use a number that is not currently registered in the regular WhatsApp or WhatsApp Business app.</li>
              <li>You need to be an admin of your business on Facebook (Meta Business Suite).</li>
              <li>Meta may ask you to verify your business before you can message large numbers of customers.</li>
            </ul>
            {!canManage ? (
              <p className="text-muted-foreground">Only workspace owners and admins can connect WhatsApp.</p>
            ) : !config ? (
              <Alert>
                <AlertDescription>
                  WhatsApp connection is not available on this server yet. Contact {brand.supportEmail}.
                </AlertDescription>
              </Alert>
            ) : !ctx.user.emailVerifiedAt ? (
              <Alert>
                <AlertDescription>
                  Verify your email address first. Use the link in the banner at the top of the page.
                </AlertDescription>
              </Alert>
            ) : (
              <Connect slug={slug} appId={config.appId} configId={config.configId} apiVersion={config.apiVersion} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
