import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/AdminConsole";
import { requireAdmin } from "@/lib/admin-server";
import { AuthenticationError } from "@/lib/auth-server";

export default async function AdminPage() {
  let user;
  try { user = await requireAdmin(); } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) redirect("/login");
    const forbidden = error instanceof AuthenticationError && error.status === 403;
    return <main className="auth-page"><h1>{forbidden ? "Admin access required" : "Account management unavailable"}</h1>
      <p role="alert">{forbidden ? "Your account can use assessments, but cannot manage users." : "Please try again shortly."}</p>
      <Link href="/">Back to assessments</Link></main>;
  }
  return <AdminConsole actorId={user.id} />;
}
