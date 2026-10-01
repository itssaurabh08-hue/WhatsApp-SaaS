import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { defaultLandingPath } from "@/server/auth/landing";
import { getCurrentSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next, "") : "";
  const session = await getCurrentSession();
  if (session) redirect(next || (await defaultLandingPath(session.user.id)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back. Sign in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {params.reset === "1" && (
          <Alert variant="success">
            <AlertDescription>Your password was changed. Sign in with your new password.</AlertDescription>
          </Alert>
        )}
        <LoginForm next={next || undefined} />
        <p className="text-muted-foreground text-center text-sm">
          New here?{" "}
          <Link href="/signup" className="text-foreground font-medium underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
