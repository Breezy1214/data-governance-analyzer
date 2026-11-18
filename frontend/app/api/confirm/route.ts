import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { AuthenticationError, accountError, json, sameOriginRoute, serverAuth } from "@/lib/auth-server";

export const POST = sameOriginRoute(async (request) => {
  const input = await request.json().catch(() => null);
  const tokenHash = typeof input?.tokenHash === "string" ? input.tokenHash : "";
  const type = input?.type === "email" || input?.type === "recovery" ? (input.type as "email" | "recovery") : null;
  const invalid = new AuthenticationError(400, AUTH_MESSAGES.linkInvalid);
  if (!type || !tokenHash || tokenHash.length > 512) throw invalid;
  const client = await serverAuth();
  const { error } = await client.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) throw accountError(error, invalid);
  return json({ ok: true });
});
