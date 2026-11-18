import { accountError, json, parseEmail, sameOriginRoute, serverAuth } from "@/lib/auth-server";
import { limitAuthAttempts } from "@/lib/rate-limit";

export const POST = sameOriginRoute(async (request) => {
  limitAuthAttempts(request, "forgot-password");
  const input = await request.json().catch(() => null);
  const email = parseEmail(input?.email);
  const client = await serverAuth();
  const { error } = await client.auth.resetPasswordForEmail(email);
  if (error) throw accountError(error);
  return json({ ok: true });
});
