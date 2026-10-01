import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmailForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Verify your email</CardTitle>
        <CardDescription>Confirm this email address belongs to you.</CardDescription>
      </CardHeader>
      <CardContent>
        {typeof token === "string" && token ? (
          <VerifyEmailForm token={token} />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              This verification link is incomplete. Open the link from your email again.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
