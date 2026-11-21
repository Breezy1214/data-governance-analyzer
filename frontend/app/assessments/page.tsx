import type { Metadata } from "next";
import Link from "next/link";
import { RISK_LABELS } from "@/components/AssessmentResultView";
import { DeleteAssessmentButton } from "@/components/DeleteAssessmentButton";
import { Icon } from "@/components/Icons";
import { LocalTime } from "@/components/LocalTime";
import { RegisterShell } from "@/components/RegisterShell";
import { loadRegister } from "@/lib/register-page";
import { REGISTER_PATH, STATUS_LABELS, assessmentPath, isDeletable } from "@/lib/register";

export const metadata: Metadata = { title: "My assessments · Data Governance Readiness Analyzer" };

export default async function MyAssessments() {
  const { session, entries } = await loadRegister();
  return (
    <RegisterShell email={session.user.email} section="My assessments" current={REGISTER_PATH} title="My assessments"
      intro="Every assessment you complete is saved here with its answers, result and versions. Use-case descriptions are never saved.">
      <div className="step-panel">
        {entries.length === 0 ? (
          <div className="card register-empty">
            <span className="empty-icon"><Icon name="register" size={24} /></span>
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
                <tr><th scope="col">Assessment</th><th scope="col">Risk</th><th scope="col">Status</th><th scope="col">Last saved</th>
                  <th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.assessmentId}>
                    <th scope="row">
                      <Link href={assessmentPath(entry.assessmentId)}>{entry.title}</Link>
                      <small>Version {entry.version}{entry.versionCount > 1 ? ` of ${entry.versionCount}` : ""}</small>
                    </th>
                    <td data-risk={entry.level.toLowerCase()}>
                      <span className="risk-label">{RISK_LABELS[entry.level]} · {entry.score}</span>
                    </td>
                    <td><span className="badge badge-neutral">{STATUS_LABELS[entry.status]}</span></td>
                    <td className="register-saved"><LocalTime value={entry.savedAt} /></td>
                    <td className="register-actions">
                      {isDeletable(entry.status) && (
                        <DeleteAssessmentButton assessmentId={entry.assessmentId} title={entry.title} versionCount={entry.versionCount} />
                      )}
                    </td>
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
