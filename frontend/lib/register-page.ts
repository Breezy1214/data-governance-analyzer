import "server-only";
import { notFound, redirect } from "next/navigation";
import { AuthenticationError, authenticatedSession } from "./auth-server";
import { readFromBackend } from "./backend-proxy";
import { type RegisterEntry, type SavedAssessmentVersion, isUuid, toRegisterEntry, toSavedVersion } from "./register";

/** Register pages read through FastAPI with the visitor's token; a lapsed session goes back to sign-in. */
export async function signedInRead<T>(read: (accessToken: string) => Promise<T>) {
  try {
    const { accessToken, payload } = await authenticatedSession();
    return { accessToken, session: payload, data: await read(accessToken) };
  } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) redirect("/login");
    throw error;
  }
}

export async function loadRegister() {
  const { session, data } = await signedInRead((token) => readFromBackend("/assessments", token));
  const entries = Array.isArray(data) ? data.map(toRegisterEntry) : [];
  return { session, entries: entries.filter((entry): entry is RegisterEntry => entry !== null) };
}

export type AssessmentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
};

/** Every version of the assessment in the URL and the one asked for (the latest by default), or a 404. */
export async function loadAssessmentPage({ params, searchParams }: AssessmentPageProps) {
  const [{ id }, { version }] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const { accessToken, session, data } = await signedInRead((token) => readFromBackend(`/assessments/${id}`, token));
  const raw = data && typeof data === "object" && "versions" in data && Array.isArray(data.versions) ? data.versions : [];
  const versions = raw.map((entry) => toSavedVersion(id, entry))
    .filter((entry): entry is SavedAssessmentVersion => entry !== null);
  const requested = Number(version);
  const selected = version === undefined ? versions.at(-1) : versions.find((entry) => entry.version === requested);
  if (!selected) notFound();
  return { accessToken, session, versions, selected, latest: versions.at(-1)! };
}
