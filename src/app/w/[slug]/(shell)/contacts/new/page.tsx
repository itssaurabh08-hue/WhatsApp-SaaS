import type { Metadata } from "next";
import { ContactForm } from "@/components/app/contact-form";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { listCountries } from "@/lib/phone";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { saveContactAction } from "../actions";

export const metadata: Metadata = { title: "Add contact" };

export default async function NewContactPage({ params }: PageProps<"/w/[slug]/contacts/new">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:write")) return <NoAccess />;
  const customFields = await listCustomFields(ctx);
  return (
    <>
      <PageHeader title="Add contact" />
      <Card className="max-w-3xl">
        <CardContent>
          <ContactForm
            action={saveContactAction.bind(null, slug, null)}
            countries={listCountries()}
            customFields={customFields}
            defaults={{ country: ctx.workspace.defaultCountry ?? "", optInStatus: "UNKNOWN" }}
            customDefaults={{}}
            submitLabel="Add contact"
          />
        </CardContent>
      </Card>
    </>
  );
}
