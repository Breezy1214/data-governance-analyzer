import { accountError, json, requireEmailLinkSession, sameOriginRoute } from "@/lib/auth-server";
import { requireNewPassword } from "@/lib/new-password";

export const POST = sameOriginRoute(async (request) => {
  const { client } = await requireEmailLinkSession();
  const input = await request.json().catch(() => null);
  const password = await requireNewPassword(input?.password);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw accountError(error);
  await client.auth.signOut({ scope: "others" });
  return json({ ok: true });
});
