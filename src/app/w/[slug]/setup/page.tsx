import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/app/brand-mark";
import { BusinessDetailsForm } from "@/components/app/business-details-form";
import { OnboardingSteps, type OnboardingStepKey } from "@/components/app/onboarding-steps";
import { SubmitButton } from "@/components/app/submit-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { listCountries } from "@/lib/phone";
import { listTimezones } from "@/lib/timezones";
import { can, getTenantContext } from "@/server/authz/tenant";
import { getPlatformConfig } from "@/server/providers/whatsapp";
import { Connect } from "../(shell)/settings/whatsapp/connect";
import { continueOnboardingAction, saveBusinessDetailsAction } from "../actions";

export const metadata: Metadata = { title: "Set up workspace" };

export default async function SetupPage({ params }: PageProps<"/w/[slug]/setup">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  const step = ctx.workspace.onboardingStep as OnboardingStepKey;
  if (step === "DONE" || !can(ctx, "workspace:update")) redirect(`/w/${slug}`);
  const whatsappConfig = can(ctx, "whatsapp:manage") ? getPlatformConfig() : null;

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <BrandMark />
        <Link href={`/w/${slug}`} className="text-muted-foreground text-sm underline-offset-4 hover:underline">
          Finish later
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-4xl gap-8 px-4 pb-16 md:grid-cols-[220px_1fr]">
        <OnboardingSteps current={step} />
        <div className="max-w-xl">
          {step === "BUSINESS" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Business details</CardTitle>
                <CardDescription>Tell us about your business. You can change this later in Settings.</CardDescription>
              </CardHeader>
              <CardContent>
                <BusinessDetailsForm
                  variant="onboarding"
                  action={saveBusinessDetailsAction.bind(null, slug)}
                  timezones={listTimezones(ctx.workspace.timezone)}
                  countries={listCountries()}
                  defaults={{
                    businessName: ctx.workspace.businessName ?? ctx.workspace.name,
                    timezone: ctx.workspace.timezone,
                    currency: ctx.workspace.currency,
                    defaultCountry: ctx.workspace.defaultCountry ?? "",
                  }}
                />
              </CardContent>
            </Card>
          )}
          {step === "WHATSAPP" && (
            <StepCard
              slug={slug}
              step={step}
              title="Connect WhatsApp"
              description="You will connect your WhatsApp Business account and phone number using Meta's official WhatsApp Business Platform."
            >
              <div className="grid gap-4 text-sm">
                <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                  <li>A Facebook window opens where you sign in and pick or create your business.</li>
                  <li>You create or choose a WhatsApp Business account and verify your number by SMS or call.</li>
                  <li>
                    Use a number that is not currently registered in the regular WhatsApp or WhatsApp Business app.
                  </li>
                </ul>
                {!whatsappConfig ? (
                  <p className="text-muted-foreground">
                    WhatsApp connection is not available on this server yet. You can skip this step for now.
                  </p>
                ) : !ctx.user.emailVerifiedAt ? (
                  <p className="text-muted-foreground">
                    Verify your email address first (check your inbox), then connect. You can also skip and connect
                    later from Settings.
                  </p>
                ) : (
                  <Connect
                    slug={slug}
                    appId={whatsappConfig.appId}
                    configId={whatsappConfig.configId}
                    apiVersion={whatsappConfig.apiVersion}
                  />
                )}
              </div>
            </StepCard>
          )}
          {step === "CONTACTS" && (
            <StepCard
              slug={slug}
              step={step}
              title="Import contacts"
              description="Bring in the customers you want to message, with their opt-in status."
            >
              <div className="text-muted-foreground grid gap-3 text-sm">
                <p>
                  Upload a CSV file with at least a phone number column. You will map columns, review a preview with any
                  errors, and choose how to record opt-in before anything is imported.
                </p>
                <p>
                  <Link
                    className="text-foreground font-medium underline underline-offset-4"
                    href={`/w/${slug}/contacts/import`}
                  >
                    Import contacts now
                  </Link>{" "}
                  or skip this step and import later from Contacts.
                </p>
              </div>
            </StepCard>
          )}
          {step === "TEMPLATES" && (
            <StepCard
              slug={slug}
              step={step}
              title="How message templates work"
              description="WhatsApp requires pre-approved templates for some messages."
              continueLabel="Go to dashboard"
            >
              <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm">
                <li>
                  <span className="text-foreground">Templates</span> are messages you write in advance and submit to
                  Meta for review. Only approved templates can start a conversation or be used in campaigns.
                </li>
                <li>
                  <span className="text-foreground">Variables</span> such as {"{{1}}"} are filled per contact, for
                  example the customer&apos;s name or an order number.
                </li>
                <li>
                  <span className="text-foreground">Replies</span>: after a customer messages you, you can reply with
                  normal messages for a limited time window set by WhatsApp. Outside it, you need a template.
                </li>
                <li>
                  <span className="text-foreground">Opt-in</span>: only message people who agreed to hear from you, and
                  respect opt-outs.
                </li>
              </ul>
            </StepCard>
          )}
        </div>
      </main>
    </div>
  );
}

function StepCard({
  slug,
  step,
  title,
  description,
  continueLabel = "Skip for now",
  children,
}: {
  slug: string;
  step: string;
  title: string;
  description: string;
  continueLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter>
        <form action={continueOnboardingAction.bind(null, slug, step)}>
          <SubmitButton variant={continueLabel === "Skip for now" ? "outline" : "default"}>
            {continueLabel}
          </SubmitButton>
        </form>
      </CardFooter>
    </Card>
  );
}
