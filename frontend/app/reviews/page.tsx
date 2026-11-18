import Link from "next/link";
import { signedInRead } from "@/lib/register-page";
import { reviewQueue, reviewWorkspaces } from "@/lib/review-server";
import { assessmentPath, STATUS_LABELS } from "@/lib/register";
import { WorkspaceControls } from "@/components/WorkspaceControls";
import { RegisterShell } from "@/components/RegisterShell";

export default async function ReviewsPage() {
  const { session, data: [workspaces, data] } = await signedInRead((token) =>
    Promise.all([reviewWorkspaces(token), reviewQueue(token)]));
  return <RegisterShell email={session.user.email} section="Reviews" current="/reviews" title="Workspace reviews">
    <WorkspaceControls userId={session.user.id} workspaces={workspaces} />
    <section className="card"><h2>Submitted versions</h2>
      <p>Reviewers see submitted versions in their workspaces. Your own submissions appear here too.</p>
      <ul>{(data ?? []).map((v) => <li key={v.id}><Link href={assessmentPath(v.assessment_id, v.version)}>Version {v.version} · {v.assessment_id.slice(0, 8)}</Link> — {STATUS_LABELS[v.status as keyof typeof STATUS_LABELS]}</li>)}</ul>
      {!data?.length && <p>No submitted assessments are available.</p>}
    </section>
  </RegisterShell>;
}
