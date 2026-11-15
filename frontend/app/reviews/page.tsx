import Link from "next/link";
import { signedIn } from "@/lib/register-page";
import { reviewClient, reviewFailure, reviewWorkspaces } from "@/lib/review-server";
import { assessmentPath, STATUS_LABELS } from "@/lib/register";
import { WorkspaceControls } from "@/components/WorkspaceControls";
import { RegisterShell } from "@/components/RegisterShell";

export default async function ReviewsPage() {
  const { client, session } = await signedIn();
  const workspaces = await reviewWorkspaces(client, session.user.id);
  const { data, error } = await reviewClient(client).from("assessment_versions")
    .select("id,assessment_id,version,status,created_at").neq("status", "draft").order("created_at", { ascending: false });
  reviewFailure(error);
  return <RegisterShell email={session.user.email} section="Reviews" current="/reviews" title="Workspace reviews">
    <WorkspaceControls userId={session.user.id} workspaces={workspaces} />
    <section className="card"><h2>Submitted versions</h2>
      <p>Reviewers see submitted versions in their workspaces. Your own submissions appear here too.</p>
      <ul>{(data ?? []).map((v) => <li key={v.id}><Link href={assessmentPath(v.assessment_id, v.version)}>Version {v.version} · {v.assessment_id.slice(0, 8)}</Link> — {STATUS_LABELS[v.status as keyof typeof STATUS_LABELS]}</li>)}</ul>
      {!data?.length && <p>No submitted assessments are available.</p>}
    </section>
  </RegisterShell>;
}
