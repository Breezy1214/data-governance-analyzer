import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentResult, SavedVersion } from "./assessment";
import type { Database, Json } from "./database.types";
import { type RegisterEntry, type SavedAssessmentVersion, isUuid, toRegisterEntry, toSavedVersion } from "./register";

/**
 * Register reads and writes run as the signed-in user through Supabase, so row-level security decides what is
 * visible (supabase/migrations). Nothing here uses a service key.
 */

type Client = SupabaseClient<Database>;

export class RegisterError extends Error {
  constructor(public readonly status: 404 | 409 | 503) {
    super(`Register request failed with ${status}`);
  }
}

const VERSION_COLUMNS = "id, assessment_id, version, status, answers, result, created_at";

/** Saves a scored version, starting a new assessment when `assessmentId` is null. */
export async function saveScoredVersion(
  client: Client, answers: Json, result: AssessmentResult, assessmentId: string | null,
): Promise<SavedVersion> {
  const { data, error } = await client.rpc("save_assessment_version", {
    scored_answers: answers,
    scored_result: result as unknown as Json,
    // The generated type marks every argument as required; null is how the function starts a new assessment.
    target_assessment: assessmentId as string,
  });
  if (error || !data) throw new RegisterError(error?.code === "P0002" ? 404 : 503);
  return { assessmentId: data.assessment_id, version: data.version };
}

async function assessmentExists(client: Client, assessmentId: string) {
  const { data, error } = await client.from("assessments").select("id").eq("id", assessmentId).maybeSingle();
  if (error) throw new RegisterError(503);
  return data !== null;
}

export async function listRegister(client: Client): Promise<RegisterEntry[]> {
  const { data, error } = await client.from("assessment_register")
    .select("assessment_id, version, version_count, status, score, risk_level, answers, saved_at")
    .order("saved_at", { ascending: false });
  if (error) throw new RegisterError(503);
  return data.map(toRegisterEntry).filter((entry): entry is RegisterEntry => entry !== null);
}

/** Every version of one assessment, oldest first; empty when it doesn't exist or isn't the caller's. */
export async function loadVersions(client: Client, assessmentId: string): Promise<SavedAssessmentVersion[]> {
  if (!isUuid(assessmentId)) return [];
  const { data, error } = await client.from("assessment_versions").select(VERSION_COLUMNS)
    .eq("assessment_id", assessmentId).order("version");
  if (error) throw new RegisterError(503);
  return data.map(toSavedVersion).filter((version): version is SavedAssessmentVersion => version !== null);
}

/** Deletes an assessment with all its versions. RLS refuses while any version is in review or approved. */
export async function deleteAssessment(client: Client, assessmentId: string) {
  if (!isUuid(assessmentId)) throw new RegisterError(404);
  const { data, error } = await client.from("assessments").delete().eq("id", assessmentId).select("id");
  if (error) throw new RegisterError(503);
  // Nothing deleted: either it isn't visible to this user, or RLS kept it because a decision is pending.
  if (data.length === 0) throw new RegisterError((await assessmentExists(client, assessmentId)) ? 409 : 404);
}
