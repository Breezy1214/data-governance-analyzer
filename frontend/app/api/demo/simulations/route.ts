import { sameOriginRoute } from "@/lib/auth-server";
import { demoClientHeaders, forwardToBackend } from "@/lib/backend-proxy";

/** What-if scoring for the sample scenarios, under the same per-visitor limit as demo assessments. */
export const POST = sameOriginRoute(async (request) =>
  forwardToBackend(request, "/demo/simulations", demoClientHeaders(request)));
