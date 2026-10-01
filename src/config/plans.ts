/**
 * Plan limits and feature flags. Prices are not defined here: they live in the
 * billing provider (e.g. Stripe price ids configured via env) so pricing can
 * change without a deploy. `null` means unlimited.
 */
export type PlanId = "free" | "starter" | "growth" | "enterprise";

export interface PlanLimits {
  contacts: number | null;
  members: number | null;
  monthlyMessages: number | null;
  monthlyCampaigns: number | null;
  monthlyApiCalls: number | null;
  storageMb: number | null;
  monthlyAutomationRuns: number | null;
}

export interface PlanFeatures {
  automations: boolean;
  api: boolean;
  outboundWebhooks: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  limits: PlanLimits;
  features: PlanFeatures;
}

export const plans: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    limits: {
      contacts: 500,
      members: 2,
      monthlyMessages: 1_000,
      monthlyCampaigns: 3,
      monthlyApiCalls: 0,
      storageMb: 100,
      monthlyAutomationRuns: 0,
    },
    features: { automations: false, api: false, outboundWebhooks: false },
  },
  starter: {
    id: "starter",
    name: "Starter",
    limits: {
      contacts: 10_000,
      members: 5,
      monthlyMessages: 25_000,
      monthlyCampaigns: 50,
      monthlyApiCalls: 0,
      storageMb: 1_000,
      monthlyAutomationRuns: 0,
    },
    features: { automations: false, api: false, outboundWebhooks: false },
  },
  growth: {
    id: "growth",
    name: "Growth",
    limits: {
      contacts: 100_000,
      members: 20,
      monthlyMessages: 250_000,
      monthlyCampaigns: null,
      monthlyApiCalls: 500_000,
      storageMb: 10_000,
      monthlyAutomationRuns: 100_000,
    },
    features: { automations: true, api: true, outboundWebhooks: true },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    limits: {
      contacts: null,
      members: null,
      monthlyMessages: null,
      monthlyCampaigns: null,
      monthlyApiCalls: null,
      storageMb: null,
      monthlyAutomationRuns: null,
    },
    features: { automations: true, api: true, outboundWebhooks: true },
  },
};

export const DEFAULT_PLAN_ID: PlanId = "free";

export function getPlan(planId: string): PlanDefinition {
  return plans[planId as PlanId] ?? plans[DEFAULT_PLAN_ID];
}
