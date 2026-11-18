import { accountError, json, requireEmailLinkSession, sameOriginRoute } from "@/lib/auth-server";
import { limitAuthAttempts } from "@/lib/rate-limit";
import { requireNewPassword } from "@/lib/new-password";

export const POST = sameOriginRoute(async (request) => {
  limitAuthAttempts(request, "update-password");
  const { client } = await requireEmailLinkSession();
  const input = await request.json().catch(() => null);
  const password = await requireNewPassword(input?.password);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw accountError(error);
  await client.auth.signOut({ scope: "others" });
  return json({ ok: true });
});
