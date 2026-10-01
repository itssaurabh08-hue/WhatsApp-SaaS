"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3Icon,
  BlocksIcon,
  CreditCardIcon,
  FileTextIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  SettingsIcon,
  UsersIcon,
  UsersRoundIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon, NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  inbox: InboxIcon,
  contacts: UsersRoundIcon,
  campaigns: MegaphoneIcon,
  templates: FileTextIcon,
  automations: WorkflowIcon,
  analytics: BarChart3Icon,
  integrations: BlocksIcon,
  team: UsersIcon,
  billing: CreditCardIcon,
  settings: SettingsIcon,
};

/** Items are pre-filtered by permission on the server; this component only renders. */
export function SidebarNav({ slug, items, onNavigate }: { slug: string; items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const base = `/w/${slug}`;

  const isActive = (path: string, exact: boolean) => {
    const href = base + path;
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav aria-label="Main" className="grid gap-0.5 text-sm">
      {items.map((item) => {
        const Icon = item.icon ? ICONS[item.icon] : null;
        const active = isActive(item.path, item.path === "" || !!item.children);
        const sectionActive = isActive(item.path, false) && item.path !== "";
        return (
          <div key={item.label}>
            <Link
              href={base + (item.children?.[0]?.path ?? item.path)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2.5 rounded-md px-2.5 py-1.5",
                (active || sectionActive) && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
            >
              {Icon && <Icon className="size-4 shrink-0" />}
              {item.label}
            </Link>
            {item.children && sectionActive && (
              <div className="my-0.5 ml-[1.15rem] grid gap-0.5 border-l pl-2.5">
                {item.children.map((child) => {
                  const childActive = isActive(child.path, true);
                  return (
                    <Link
                      key={child.path}
                      href={base + child.path}
                      onClick={onNavigate}
                      aria-current={childActive ? "page" : undefined}
                      className={cn(
                        "text-sidebar-foreground/70 hover:text-sidebar-foreground rounded-md px-2 py-1",
                        childActive && "text-sidebar-foreground font-medium",
                      )}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
