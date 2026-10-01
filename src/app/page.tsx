import { redirect } from "next/navigation";
import { defaultLandingPath } from "@/server/auth/landing";
import { getCurrentSession } from "@/server/auth/session";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session ? await defaultLandingPath(session.user.id) : "/login");
}
