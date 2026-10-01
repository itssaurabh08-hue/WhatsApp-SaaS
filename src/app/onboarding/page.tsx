import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/app/brand-mark";
import { OnboardingSteps } from "@/components/app/onboarding-steps";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/server/auth/session";
import { listUserWorkspaces } from "@/server/workspace/service";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const session = await requireSession();
  const workspaces = await listUserWorkspaces(session.user.id);
  const appHost = new URL(process.env.APP_URL ?? "http://localhost:3000").host;

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="px-6 py-5">
        <BrandMark />
      </header>
      <main className="mx-auto grid w-full max-w-4xl gap-8 px-4 pb-16 md:grid-cols-[220px_1fr]">
        <OnboardingSteps current="WORKSPACE" />
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Create your workspace</CardTitle>
            <CardDescription>
              A workspace holds your WhatsApp numbers, contacts, conversations and team. You can invite teammates later.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <CreateWorkspaceForm appHost={appHost} />
            {workspaces.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Or go back to{" "}
                <Link className="underline" href={`/w/${workspaces[0]!.workspace.slug}`}>
                  {workspaces[0]!.workspace.name}
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
