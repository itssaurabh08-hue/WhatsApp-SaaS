import { redirect } from "next/navigation";

export default async function IntegrationsPage({ params }: PageProps<"/w/[slug]/integrations">) {
  redirect(`/w/${(await params).slug}/integrations/api`);
}
