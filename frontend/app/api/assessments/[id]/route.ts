import { NO_STORE, authenticatedSession, json, sameOriginRoute } from "@/lib/auth-server";
import { RegisterError, deleteAssessment } from "@/lib/register-server";

const MESSAGES = {
  404: "That assessment could not be found.",
  409: "This assessment has a version in review or approved, so it can't be deleted.",
  503: "The register is unavailable. Please try again.",
} as const;

export const DELETE = sameOriginRoute(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const { client } = await authenticatedSession();
  try {
    await deleteAssessment(client, (await params).id);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    if (error instanceof RegisterError) return json({ message: MESSAGES[error.status] }, error.status);
    throw error;
  }
});
