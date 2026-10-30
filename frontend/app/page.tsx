import { redirect } from "next/navigation";
import Link from "next/link";
import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { currentSession } from "@/lib/auth-server";
import { AuthenticatedAssessment } from "@/components/AuthenticatedAssessment";

export default async function Home() {
  let session;
  try {
    session = await currentSession();
  } catch {
    return (
      <main className="auth-page">
        <header className="auth-heading"><h1>Sign-in unavailable</h1></header>
        <p className="error" role="alert">{AUTH_MESSAGES.unavailable}</p>
        <Link href="/">Try again</Link>
      </main>
    );
  }
  if (!session) redirect("/login");
  return <AuthenticatedAssessment session={session} />;
}
