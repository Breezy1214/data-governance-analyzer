import { sameOriginPost } from "@/lib/auth-server";
import { forwardAssessment } from "@/lib/backend-proxy";

/** Public scoring for the sample scenarios. The backend rate-limits it per visitor. */
export const POST = sameOriginPost(async (request) => {
  // The hosting platform sets the first X-Forwarded-For entry to the visitor's address.
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardAssessment(request, "/demo/assessments", client ? { "X-Demo-Client": client } : {});
});
