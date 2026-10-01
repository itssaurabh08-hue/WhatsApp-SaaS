import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import type { MetaTemplateComponent } from "@/lib/templates";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { listContactLists } from "@/server/contacts/lists";
import { listSegments } from "@/server/contacts/segments";
import { listTags } from "@/server/contacts/tags";
import { listSendableTemplates } from "@/server/templates/service";
import { listWhatsAppAccounts } from "@/server/whatsapp/connection";
import { CampaignForm } from "./campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: PageProps<"/w/[slug]/campaigns/new">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "campaigns:manage")) return <NoAccess />;
  const accounts = (await listWhatsAppAccounts(ctx)).filter((a) => a.status === "CONNECTED");
  const [lists, tags, segments, fields, templatesByAccount] = await Promise.all([
    listContactLists(ctx),
    listTags(ctx),
    listSegments(ctx),
    listCustomFields(ctx),
    Promise.all(
      accounts.map(async (a) => [
        a.id,
        (await listSendableTemplates(ctx, a.id)).map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          components: t.components as unknown as MetaTemplateComponent[],
        })),
      ]),
    ).then(Object.fromEntries),
  ]);

  return (
    <>
      <PageHeader title="New campaign" description="Send an approved template to a group of contacts." />
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Connect a WhatsApp number first in{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/w/${slug}/settings/whatsapp`}>
            Settings &gt; WhatsApp
          </Link>
          .
        </p>
      ) : (
        <CampaignForm
          slug={slug}
          accounts={accounts.map((a) => ({ id: a.id, label: a.displayPhoneNumber ?? a.phoneNumberId }))}
          templatesByAccount={templatesByAccount}
          audiences={{
            list: lists.map((l) => ({ id: l.id, name: l.name })),
            tag: tags.map((t) => ({ id: t.id, name: t.name })),
            segment: segments.map((s) => ({ id: s.id, name: s.name })),
          }}
          customFields={fields.map((f) => ({ key: `custom.${f.key}`, label: f.label }))}
        />
      )}
    </>
  );
}
