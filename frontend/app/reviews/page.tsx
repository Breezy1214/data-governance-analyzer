import type { Metadata } from "next";
import Link from "next/link";
import { RISK_LABELS } from "@/components/AssessmentResultView";
import { LocalTime } from "@/components/LocalTime";
import { RegisterShell } from "@/components/RegisterShell";
import { WorkspaceControls } from "@/components/WorkspaceControls";
import { signedInRead } from "@/lib/register-page";
import { assessmentPath } from "@/lib/register";
import { reviewQueue, reviewWorkspaces } from "@/lib/review-server";

export const metadata: Metadata = { title: "Workspace reviews · Data Governance Readiness Analyzer" };

export default async function ReviewsPage() {
  const { session, data: [workspaces, queue] } = await signedInRead((token) =>
    Promise.all([reviewWorkspaces(token), reviewQueue(token)]));
  return (
    <RegisterShell email={session.user.email} section="Workspace reviews" current="/reviews" title="Workspace reviews"
      intro="Decide on your team’s submissions and choose who reviews yours.">
      <div className="step-panel">
        <div className="card">
          <h2 className="card-title">Awaiting your decision</h2>
          {queue.length === 0 ? <p className="method-note">Nothing to review.</p> : (
            <table className="register-table">
              <caption className="sr-only">Submitted versions awaiting your decision, oldest first</caption>
              <thead>
                <tr><th scope="col">Assessment</th><th scope="col">Risk</th><th scope="col">Workspace</th><th scope="col">Saved</th></tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <Link href={assessmentPath(entry.assessmentId, entry.version)}>{entry.title}</Link>
                      <small>Version {entry.version}</small>
                    </th>
                    <td data-risk={entry.level.toLowerCase()}>
                      <span className="risk-label">{RISK_LABELS[entry.level]} · {entry.score}</span>
                    </td>
                    <td>{entry.workspace}</td>
                    <td className="register-saved"><LocalTime value={entry.savedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <WorkspaceControls userId={session.user.id} workspaces={workspaces} />
      </div>
    </RegisterShell>
  );
}
