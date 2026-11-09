import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/AccountForms";
import { requireEmailLinkSession } from "@/lib/auth-server";

export default async function UpdatePassword() {
  const session = await requireEmailLinkSession().catch(() => null);
  if (!session) redirect("/forgot-password?reason=expired");
  return <UpdatePasswordForm />;
}
