import { ForgotPasswordForm } from "@/components/AccountForms";

export default async function ForgotPassword({ searchParams }: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <ForgotPasswordForm expired={reason === "expired"} />;
}
