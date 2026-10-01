import "server-only";
import { NAVIGATION, type NavItem } from "@/config/navigation";
import { roleHasPermission, type Role } from "@/lib/permissions";

/** Navigation visible to a role. Hiding is cosmetic; every page re-checks permissions. */
export function navigationFor(role: Role): NavItem[] {
  return NAVIGATION.filter((item) => roleHasPermission(role, item.permission)).map((item) => ({
    ...item,
    children: item.children?.filter((child) => roleHasPermission(role, child.permission)),
  }));
}
