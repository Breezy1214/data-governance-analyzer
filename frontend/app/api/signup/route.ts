import { accountError, json, parseEmail, sameOriginRoute, serverAuth } from "@/lib/auth-server";
import { requireNewPassword } from "@/lib/new-password";

const EXISTING_ACCOUNT_CODES = ["user_already_exists", "email_exists"];

export const POST = sameOriginRoute(async (request) => {
  const input = await request.json().catch(() => null);
  const email = parseEmail(input?.email);
  const password = await requireNewPassword(input?.password);
  const client = await serverAuth();
  const { error } = await client.auth.signUp({ email, password });
  // The same response for new and existing addresses, so sign-up never reveals who has an account.
  if (error && !EXISTING_ACCOUNT_CODES.includes(error.code ?? "")) throw accountError(error);
  return json({ ok: true });
});
