import { sameOriginRoute } from "@/lib/auth-server";
import { demoClientHeaders, forwardToBackend } from "@/lib/backend-proxy";

/** Public scoring for the sample scenarios. The backend rate-limits it per visitor. */
export const POST = sameOriginRoute(async (request) =>
  forwardToBackend(request, "/demo/assessments", demoClientHeaders(request)));
