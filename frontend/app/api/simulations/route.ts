import { authenticatedSession, sameOriginRoute } from "@/lib/auth-server";
import { bearer, forwardToBackend } from "@/lib/backend-proxy";

/** What-if scoring for a signed-in result. The backend never writes the register from this route. */
export const POST = sameOriginRoute(async (request) =>
  forwardToBackend(request, "/simulations", bearer((await authenticatedSession()).accessToken)));
