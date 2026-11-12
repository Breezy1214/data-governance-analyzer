import { authenticatedSession, sameOriginPost } from "@/lib/auth-server";
import { forwardAssessment } from "@/lib/backend-proxy";

export const POST = sameOriginPost(async (request) => {
  const { accessToken } = await authenticatedSession();
  return forwardAssessment(request, "/assessments", { Authorization: `Bearer ${accessToken}` });
});
