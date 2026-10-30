import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { AuthenticationError, errorResponse, json, requireSameOrigin, serverAuth } from "@/lib/auth-server";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await request.json().catch(() => null);
    const email = typeof input?.email === "string" ? input.email.trim() : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (!email.includes("@") || email.length > 254 || !password || password.length > 1024) {
      throw new AuthenticationError(400, AUTH_MESSAGES.invalidInput);
    }
    const client = await serverAuth();
    const { error } = await client.auth.signInWithPassword({ email, password });
    // Map every client error to one message so responses never reveal whether an account exists.
    if (error?.status === 429) throw new AuthenticationError(429, AUTH_MESSAGES.rateLimited);
    if (error?.status && error.status < 500) throw new AuthenticationError(401, AUTH_MESSAGES.invalid);
    if (error) throw new AuthenticationError(503, AUTH_MESSAGES.unavailable);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
