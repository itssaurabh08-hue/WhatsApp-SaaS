import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/app/contact-form";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { contactDisplayName } from "@/lib/contacts/fields";
import { listCountries } from "@/lib/phone";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { getContact } from "@/server/contacts/service";
import { isAppError } from "@/server/errors";
import { saveContactAction } from "../../actions";

export const metadata: Metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: PageProps<"/w/[slug]/contacts/[id]/edit">) {
  const { slug, id } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:write")) return <NoAccess />;
  const contact = await getContact(ctx, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const customFields = await listCustomFields(ctx);
  const custom = (contact.customFields ?? {}) as Record<string, string>;
  return (
    <>
      <PageHeader title={`Edit ${contactDisplayName(contact)}`} />
      <Card className="max-w-3xl">
        <CardContent>
          <ContactForm
            action={saveContactAction.bind(null, slug, id)}
            countries={listCountries()}
            customFields={customFields}
            defaults={{
              phoneNumber: contact.normalizedPhoneNumber,
              country: contact.country ?? "",
              firstName: contact.firstName ?? "",
              lastName: contact.lastName ?? "",
              email: contact.email ?? "",
              company: contact.company ?? "",
              optInStatus: contact.optInStatus,
              optInSource: contact.optInSource ?? "",
            }}
            customDefaults={custom}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </>
  );
}
