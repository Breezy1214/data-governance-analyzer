import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { authenticatedSession, errorResponse, json } from "@/lib/auth-server";

export async function GET() {
  try {
    const session = await authenticatedSession();
    return session ? json(session.payload) : json({ message: AUTH_MESSAGES.expired }, 401);
  } catch (error) { return errorResponse(error); }
}
