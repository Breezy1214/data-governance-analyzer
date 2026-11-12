import type { Metadata } from "next";
import Link from "next/link";
import { RISK_LABELS } from "@/components/AssessmentResultView";
import { LocalTime } from "@/components/LocalTime";
import { RegisterShell } from "@/components/RegisterShell";
import { signedIn } from "@/lib/register-page";
import { listRegister } from "@/lib/register-server";
import { REGISTER_PATH, STATUS_LABELS, assessmentPath } from "@/lib/register";

export const metadata: Metadata = { title: "My assessments · Data Governance Readiness Analyzer" };

export default async function MyAssessments() {
  const { client, session } = await signedIn();
  const entries = await listRegister(client);
  return (
    <RegisterShell email={session.user.email} section="My assessments" current={REGISTER_PATH} title="My assessments"
      intro="Every assessment you complete is saved here with its answers, result and versions. Use-case descriptions are never saved.">
      <div className="step-panel">
        {entries.length === 0 ? (
          <div className="card register-empty">
            <h2>No saved assessments yet</h2>
            <p className="lede">Complete an assessment and its result is saved here automatically.</p>
            <Link className="primary" href="/">Start an assessment <span>→</span></Link>
          </div>
        ) : (
          <div className="card">
            <div className="register-head">
              <h2>{entries.length} {entries.length === 1 ? "assessment" : "assessments"}</h2>
              <Link className="primary" href="/">New assessment <span>→</span></Link>
            </div>
            <table className="register-table">
              <caption className="sr-only">Saved assessments, most recently saved first</caption>
              <thead>
                <tr><th scope="col">Assessment</th><th scope="col">Risk</th><th scope="col">Status</th><th scope="col">Last saved</th></tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.assessmentId}>
                    <th scope="row">
                      <Link href={assessmentPath(entry.assessmentId)}>{entry.title}</Link>
                      <small>Version {entry.version}{entry.versionCount > 1 ? ` of ${entry.versionCount}` : ""}</small>
                    </th>
                    <td data-risk={entry.level.toLowerCase()}>
                      <span className="risk-label"><span className="risk-icon" aria-hidden="true" />{RISK_LABELS[entry.level]} · {entry.score}</span>
                    </td>
                    <td><span className="badge">{STATUS_LABELS[entry.status]}</span></td>
                    <td><LocalTime value={entry.savedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RegisterShell>
  );
}
