import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { authenticatedSession, backend, errorResponse, json, requireSameOrigin } from "@/lib/auth-server";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await authenticatedSession();
    if (!session) return json({ message: AUTH_MESSAGES.expired }, 401);
    const response = await backend(request, session.accessToken);
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" },
    });
  } catch (error) { return errorResponse(error); }
}
