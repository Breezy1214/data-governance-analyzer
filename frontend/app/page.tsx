import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth-server";
import { AuthenticatedAssessment } from "@/components/AuthenticatedAssessment";

export default async function Home() {
  const session = await currentSession().catch(() => null);
  if (!session) redirect("/login");
  return <AuthenticatedAssessment session={session} />;
}

