import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Set new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>All your other sessions will be signed out.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {typeof token === "string" && token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              This reset link is incomplete.{" "}
              <Link className="underline" href="/forgot-password">
                Request a new one
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
