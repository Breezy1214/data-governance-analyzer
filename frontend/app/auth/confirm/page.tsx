import { ConfirmLinkForm } from "@/components/AccountForms";

// This page only shows a button. Email security scanners open links automatically, and would use up the token.
export default async function ConfirmLink({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  return <ConfirmLinkForm tokenHash={typeof tokenHash === "string" ? tokenHash : ""} type={type === "recovery" ? "recovery" : "email"} />;
}
