import Link from "next/link";
import { BrandMark } from "@/components/app/brand-mark";
import { MobileNav } from "@/components/app/mobile-nav";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { UserMenu } from "@/components/app/user-menu";
import { VerifyEmailBanner } from "@/components/app/verify-email-banner";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/permissions";
import { getTenantContext } from "@/server/authz/tenant";
import { navigationFor } from "@/server/navigation";
import { listUserWorkspaces } from "@/server/workspace/service";

export default async function ShellLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  const [memberships] = await Promise.all([listUserWorkspaces(ctx.user.id)]);
  const nav = navigationFor(ctx.role);
  const workspaces = memberships.map((m) => ({ slug: m.workspace.slug, name: m.workspace.name }));

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href={`/w/${slug}`}>
            <BrandMark />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <SidebarNav slug={slug} items={nav} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur lg:px-6">
          <MobileNav slug={slug} items={nav} />
          <WorkspaceSwitcher current={{ slug, name: ctx.workspace.name }} workspaces={workspaces} />
          {ctx.workspace.isDemo && <Badge variant="warning">Demo data</Badge>}
          <div className="ml-auto flex items-center gap-2">
            <UserMenu name={ctx.user.name} email={ctx.user.email} roleLabel={ROLE_LABELS[ctx.role]} />
          </div>
        </header>
        {!ctx.user.emailVerifiedAt && <VerifyEmailBanner email={ctx.user.email} />}
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
