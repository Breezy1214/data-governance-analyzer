import { authenticatedSession, errorResponse, json } from "@/lib/auth-server";

export async function GET() {
  try {
    return json((await authenticatedSession()).payload);
  } catch (error) {
    return errorResponse(error);
  }
}
