import type { Metadata } from "next";
import { NoAccess } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/permissions";
import { can, getTenantContext } from "@/server/authz/tenant";
import { listMembers } from "@/server/workspace/members";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/w/[slug]/team">) {
  const ctx = await getTenantContext((await params).slug);
  if (!can(ctx, "team:read")) return <NoAccess />;
  const members = await listMembers(ctx);
  return (
    <>
      <PageHeader
        title="Team"
        description="People who can access this workspace. Inviting teammates is coming in a later build."
      />
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="pr-5">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-5 font-medium">
                    {m.user.name}
                    {m.user.id === ctx.user.id && <span className="text-muted-foreground"> (you)</span>}
                  </TableCell>
                  <TableCell>{m.user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground pr-5">
                    {m.createdAt.toLocaleDateString("en-US", { timeZone: ctx.workspace.timezone, dateStyle: "medium" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
