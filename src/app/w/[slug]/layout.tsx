import { getTenantContext } from "@/server/authz/tenant";

/** Resolves the workspace once for every tenant route; non-members get a 404. */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  await getTenantContext(slug);
  return children;
}
