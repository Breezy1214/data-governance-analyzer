import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { AuthenticationError, errorResponse, json, requireSameOrigin, serverAuth } from "@/lib/auth-server";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const client = await serverAuth();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new AuthenticationError(503, AUTH_MESSAGES.unavailable);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
