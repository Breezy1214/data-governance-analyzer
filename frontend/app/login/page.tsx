import { LoginForm } from "@/components/LoginForm";

export default async function Login({ searchParams }: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <LoginForm expired={reason === "expired"} />;
}
