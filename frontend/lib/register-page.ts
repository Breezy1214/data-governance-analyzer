import "server-only";
import { notFound, redirect } from "next/navigation";
import { AuthenticationError, authenticatedSession } from "./auth-server";
import { loadVersions } from "./register-server";

export async function signedIn() {
  try {
    const { client, payload } = await authenticatedSession();
    return { client, session: payload };
  } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) redirect("/login");
    throw error;
  }
}

export type AssessmentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
};

/** Every version of the assessment in the URL and the one asked for (the latest by default), or a 404. */
export async function loadAssessmentPage({ params, searchParams }: AssessmentPageProps) {
  const [{ id }, { version }] = await Promise.all([params, searchParams]);
  const { client, session } = await signedIn();
  const versions = await loadVersions(client, id);
  const requested = Number(version);
  const selected = version === undefined ? versions.at(-1) : versions.find((entry) => entry.version === requested);
  if (!selected) notFound();
  return { session, versions, selected, latest: versions.at(-1)! };
}
