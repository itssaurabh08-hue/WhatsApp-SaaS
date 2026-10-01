import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listWhatsAppAccounts } from "@/server/whatsapp/connection";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage({ params }: PageProps<"/w/[slug]/templates/new">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "templates:manage")) return <NoAccess />;
  const accounts = (await listWhatsAppAccounts(ctx))
    .filter((a) => a.status === "CONNECTED")
    .map((a) => ({ id: a.id, label: a.displayPhoneNumber ?? a.phoneNumberId }));
  return (
    <>
      <PageHeader
        title="New template"
        description="Write the message, add example values, and submit it to Meta for review."
      />
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Connect a WhatsApp number first in{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/w/${slug}/settings/whatsapp`}>
            Settings &gt; WhatsApp
          </Link>
          .
        </p>
      ) : (
        <TemplateEditor slug={slug} accounts={accounts} />
      )}
    </>
  );
}
