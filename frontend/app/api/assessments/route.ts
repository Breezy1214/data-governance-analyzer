import { authenticatedSession, sameOriginRoute } from "@/lib/auth-server";
import { bearer, forwardToBackend } from "@/lib/backend-proxy";

export const POST = sameOriginRoute(async (request) =>
  forwardToBackend(request, "/assessments", bearer((await authenticatedSession()).accessToken)));
