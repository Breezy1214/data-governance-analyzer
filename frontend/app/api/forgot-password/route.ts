import { accountError, json, parseEmail, serverAuth } from "@/lib/auth-server";
import { throttledRoute } from "@/lib/rate-limit";

export const POST = throttledRoute("forgot-password", async (request) => {
  const input = await request.json().catch(() => null);
  const email = parseEmail(input?.email);
  const client = await serverAuth();
  const { error } = await client.auth.resetPasswordForEmail(email);
  if (error) throw accountError(error);
  return json({ ok: true });
});
