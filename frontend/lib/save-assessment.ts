import "server-only";
import { authenticatedSession, json } from "./auth-server";
import { isAssessmentResult } from "./assessment";
import type { Json } from "./database.types";
import { relayScore, requestScore } from "./backend-proxy";
import { isUuid } from "./register";
import { RegisterError, saveScoredVersion } from "./register-server";

const NOT_FOUND = "That assessment could not be found.";
const UNAVAILABLE = "The assessment service is unavailable.";

/**
 * Saves FastAPI's result, and the answers FastAPI accepted, to the signed-in user's register: as a new assessment,
 * or as the next version of `assessmentId`. The browser never supplies the score. A failed save still returns the
 * result, with `saved: null`, so the person keeps their assessment.
 */
export async function scoreAndSave(request: Request, assessmentId: string | null) {
  const { accessToken, client } = await authenticatedSession();
  if (assessmentId !== null && !isUuid(assessmentId)) return json({ message: NOT_FOUND }, 404);

  const scored = await requestScore(request, "/assessments", { Authorization: `Bearer ${accessToken}` });
  if (!scored.ok) return relayScore(scored);
  const { answers, ...result } = (await scored.json().catch(() => null)) ?? {};
  if (!isAssessmentResult(result)) return json({ message: UNAVAILABLE }, 502);

  try {
    return json({ ...result, saved: await saveScoredVersion(client, answers as Json, result, assessmentId) });
  } catch (error) {
    if (error instanceof RegisterError && error.status === 404) return json({ message: NOT_FOUND }, 404);
    return json({ ...result, saved: null });
  }
}
