import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const ONBOARDING_STEPS = [
  { key: "WORKSPACE", label: "Create workspace" },
  { key: "BUSINESS", label: "Business details" },
  { key: "WHATSAPP", label: "Connect WhatsApp" },
  { key: "CONTACTS", label: "Import contacts" },
  { key: "TEMPLATES", label: "Message templates" },
  { key: "DONE", label: "Go to dashboard" },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export function OnboardingSteps({ current }: { current: OnboardingStepKey }) {
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Setup progress">
      <ol className="grid gap-1 text-sm">
        {ONBOARDING_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li
              key={step.key}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                active && "bg-background font-medium shadow-xs",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  done && "border-success bg-success text-white",
                  active && "border-foreground",
                )}
              >
                {done ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              <span className={cn(!done && !active && "text-muted-foreground")}>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
