import { redirect } from "next/navigation";
import Link from "next/link";
import { currentSession } from "@/lib/auth-server";
import { AuthenticatedAssessment } from "@/components/AuthenticatedAssessment";

export default async function Home() {
  let session;
  try { session = await currentSession(); }
  catch {
    return <main className="auth-page"><h1>Sign-in temporarily unavailable</h1>
      <p>We could not verify your session. Please try again shortly.</p>
      <Link href="/">Try again</Link></main>;
  }
  if (!session) redirect("/login");
  return <AuthenticatedAssessment session={session} />;
}

