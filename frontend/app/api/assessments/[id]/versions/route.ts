import { authenticatedSession, sameOriginRoute } from "@/lib/auth-server";
import { bearer, forwardToBackend } from "@/lib/backend-proxy";

export const POST = sameOriginRoute(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const [{ id }, { accessToken }] = await Promise.all([params, authenticatedSession()]);
  return forwardToBackend(request, `/assessments/${encodeURIComponent(id)}/versions`, bearer(accessToken));
});
