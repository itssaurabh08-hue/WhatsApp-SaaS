import type { Permission } from "@/lib/permissions";

export type NavIcon =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "campaigns"
  | "templates"
  | "automations"
  | "analytics"
  | "integrations"
  | "team"
  | "billing"
  | "settings";

export interface NavItem {
  label: string;
  /** Path relative to /w/[slug]. Empty string is the workspace root. */
  path: string;
  icon?: NavIcon;
  permission: Permission;
  children?: NavItem[];
}

export const NAVIGATION: NavItem[] = [
  { label: "Dashboard", path: "", icon: "dashboard", permission: "workspace:read" },
  { label: "Inbox", path: "/inbox", icon: "inbox", permission: "inbox:read" },
  {
    label: "Contacts",
    path: "/contacts",
    icon: "contacts",
    permission: "contacts:read",
    children: [
      { label: "All Contacts", path: "/contacts", permission: "contacts:read" },
      { label: "Lists", path: "/contacts/lists", permission: "contacts:read" },
      { label: "Tags", path: "/contacts/tags", permission: "contacts:read" },
      { label: "Import", path: "/contacts/import", permission: "contacts:import" },
    ],
  },
  {
    label: "Campaigns",
    path: "/campaigns",
    icon: "campaigns",
    permission: "campaigns:read",
    children: [
      { label: "All Campaigns", path: "/campaigns", permission: "campaigns:read" },
      { label: "Create Campaign", path: "/campaigns/new", permission: "campaigns:manage" },
    ],
  },
  { label: "Templates", path: "/templates", icon: "templates", permission: "templates:read" },
  { label: "Automations", path: "/automations", icon: "automations", permission: "automations:read" },
  { label: "Analytics", path: "/analytics", icon: "analytics", permission: "analytics:read" },
  {
    label: "Integrations",
    path: "/integrations",
    icon: "integrations",
    permission: "api_keys:manage",
    children: [
      { label: "API", path: "/integrations/api", permission: "api_keys:manage" },
      { label: "Webhooks", path: "/integrations/webhooks", permission: "webhooks:manage" },
    ],
  },
  { label: "Team", path: "/team", icon: "team", permission: "team:read" },
  { label: "Billing", path: "/billing", icon: "billing", permission: "billing:read" },
  { label: "Settings", path: "/settings", icon: "settings", permission: "workspace:read" },
];
