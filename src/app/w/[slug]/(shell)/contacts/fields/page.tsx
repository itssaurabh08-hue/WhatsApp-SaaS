import type { Metadata } from "next";
import { PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { deleteCustomFieldAction } from "../actions";
import { FieldDialog } from "./field-dialog";

export const metadata: Metadata = { title: "Custom fields" };

const TYPE_LABELS = { TEXT: "Text", NUMBER: "Number", DATE: "Date", BOOLEAN: "Yes / No" } as const;

export default async function FieldsPage({ params }: PageProps<"/w/[slug]/contacts/fields">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!can(ctx, "contacts:read")) return <NoAccess />;
  const fields = await listCustomFields(ctx);
  const canManage = can(ctx, "contacts:manage_fields");
  return (
    <>
      <PageHeader
        title="Custom fields"
        description="Extra information you store on contacts, such as city or customer ID."
        actions={
          canManage ? (
            <FieldDialog
              slug={slug}
              trigger={
                <Button>
                  <PlusIcon />
                  New field
                </Button>
              }
            />
          ) : undefined
        }
      />
      {fields.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontalIcon}
          title="No custom fields yet."
          description="Add fields like City or Customer ID to use in imports and segments."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="pl-4 font-medium">{f.label}</TableCell>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell>{TYPE_LABELS[f.type]}</TableCell>
                  <TableCell className="pr-4 text-right">
                    {canManage && (
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm">
                            Delete
                          </Button>
                        }
                        title={`Delete field "${f.label}"?`}
                        description="The field is removed from forms, imports and segments. Values already stored on contacts are kept but hidden."
                        confirmLabel="Delete field"
                        action={deleteCustomFieldAction.bind(null, slug, f.id)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
