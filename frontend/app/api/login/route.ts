import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { AuthenticationError, errorResponse, json, requireSameOrigin, serverAuth } from "@/lib/auth-server";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new AuthenticationError(415, AUTH_MESSAGES.invalidInput);
    }
    const input = await request.json().catch(() => null);
    if (!input || typeof input.email !== "string" || typeof input.password !== "string"
      || input.email.length > 254 || !input.email.trim().includes("@")
      || !input.password || input.password.length > 1024) {
      throw new AuthenticationError(400, AUTH_MESSAGES.invalidInput);
    }
    const client = await serverAuth();
    const { error } = await client.auth.signInWithPassword({
      email: input.email.trim(), password: input.password,
    });
    if (error) {
      const status = error.status === 429 ? 429 : error.status && error.status < 500 ? 401 : 503;
      throw new AuthenticationError(status, status === 429 ? AUTH_MESSAGES.rateLimited
        : status === 401 ? AUTH_MESSAGES.invalid : AUTH_MESSAGES.unavailable);
    }
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
