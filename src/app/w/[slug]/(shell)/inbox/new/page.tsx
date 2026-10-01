import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { can, getTenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { listSendableTemplates } from "@/server/templates/service";
import { listWhatsAppAccounts } from "@/server/whatsapp/connection";
import { NewConversationForm } from "./new-conversation-form";
import type { MetaTemplateComponent } from "@/lib/templates";

export const metadata: Metadata = { title: "New conversation" };

export default async function NewConversationPage({ params, searchParams }: PageProps<"/w/[slug]/inbox/new">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "inbox:reply") || !can(ctx, "contacts:read")) return <NoAccess />;
  const sp = await searchParams;
  const contactId = typeof sp.contactId === "string" ? sp.contactId : null;
  const contact = contactId
    ? await db.contact.findFirst({
        where: { id: contactId, workspaceId: ctx.workspaceId },
        select: { id: true, firstName: true, lastName: true, phoneNumber: true, optInStatus: true },
      })
    : null;
  const accounts = (await listWhatsAppAccounts(ctx)).filter((a) => a.status === "CONNECTED");
  const templatesByAccount = Object.fromEntries(
    await Promise.all(
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
    ),
  );

  return (
    <>
      <PageHeader
        title="New conversation"
        description="Start a conversation with an approved template. WhatsApp requires a template for the first message."
      />
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Connect a WhatsApp number first in{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/w/${slug}/settings/whatsapp`}>
            Settings &gt; WhatsApp
          </Link>
          .
        </p>
      ) : !contact ? (
        <p className="text-muted-foreground text-sm">
          Choose who to message: open a contact in{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/w/${slug}/contacts`}>
            Contacts
          </Link>{" "}
          and select <span className="text-foreground">Send WhatsApp message</span>.
        </p>
      ) : (
        <NewConversationForm
          slug={slug}
          contact={{
            id: contact.id,
            name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.phoneNumber,
            phone: contact.phoneNumber,
            firstName: contact.firstName,
            optedOut: contact.optInStatus === "OPTED_OUT",
          }}
          accounts={accounts.map((a) => ({ id: a.id, label: a.displayPhoneNumber ?? a.phoneNumberId }))}
          templatesByAccount={templatesByAccount}
          blockedReason={ctx.user.emailVerifiedAt ? null : "Verify your email address before sending messages."}
        />
      )}
    </>
  );
}
