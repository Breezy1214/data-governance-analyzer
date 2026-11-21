import { authenticatedSession, sameOriginRoute } from "@/lib/auth-server";
import { bearer, forwardToBackend } from "@/lib/backend-proxy";

// FastAPI validates the body and identity; private database policies authorize each action.
export const POST = sameOriginRoute(async (request: Request) => {
  const { accessToken } = await authenticatedSession();
  return forwardToBackend(request, "/reviews", bearer(accessToken));
});
