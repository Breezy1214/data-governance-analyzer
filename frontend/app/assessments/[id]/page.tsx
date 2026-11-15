import type { Metadata } from "next";
import Link from "next/link";
import { AssessmentRecord, RecommendationsView, ScoreBreakdown } from "@/components/AssessmentResultView";
import { LocalTime } from "@/components/LocalTime";
import { RegisterShell } from "@/components/RegisterShell";
import { SavedAssessmentActions } from "@/components/SavedAssessmentActions";
import { type AssessmentPageProps, loadAssessmentPage } from "@/lib/register-page";
import {
  DESCRIPTION_NOT_SAVED, REGISTER_PATH, STATUS_LABELS, assessmentPath, assessmentTitle,
} from "@/lib/register";

export const metadata: Metadata = { title: "Saved assessment · Data Governance Readiness Analyzer" };

export default async function SavedAssessment(props: AssessmentPageProps) {
  const { session, versions, selected, latest } = await loadAssessmentPage(props);
  const { input, result } = selected;
  const title = assessmentTitle(input);
  // Deleting removes every version, so it is offered only while no decision is pending or made.
  const deletable = versions.every((entry) => entry.status === "draft" || entry.status === "rejected");
  const reopen = (path: string) => `${REGISTER_PATH}/${selected.assessmentId}/${path}?version=${selected.version}`;

  return (
    <RegisterShell email={session.user.email} section="Saved assessment" current={REGISTER_PATH} title={title}
      intro={<>Version {selected.version} of {versions.length} · {STATUS_LABELS[selected.status]} · Saved <LocalTime value={selected.savedAt} /></>}>
      <div className="step-panel risk-result" data-risk={result.level.toLowerCase()}>
        {selected.version !== latest.version && (
          <p className="sample-note">
            This is an earlier version. <Link href={assessmentPath(selected.assessmentId)}>See the latest (version {latest.version})</Link>.
          </p>
        )}
        <h2>The proposed use case is <em><span className="risk-icon" aria-hidden="true" />{result.level.toLowerCase()} risk.</em></h2>
        <ScoreBreakdown result={result} />
        <RecommendationsView result={result} />

        <AssessmentRecord input={input} result={result} description={DESCRIPTION_NOT_SAVED}
          status={STATUS_LABELS[selected.status]} open />

        <div className="card">
          <h3 className="card-title">Versions</h3>
          <ol className="version-list">
            {versions.toReversed().map((entry) => (
              <li key={entry.id} data-risk={entry.result.level.toLowerCase()}>
                <Link href={assessmentPath(entry.assessmentId, entry.version)}
                  aria-current={entry.version === selected.version ? "page" : undefined}>Version {entry.version}</Link>
                <span className="risk-label"><span className="risk-icon" aria-hidden="true" />{entry.result.level} · {entry.result.score}/100</span>
                <span className="badge">{STATUS_LABELS[entry.status]}</span>
                <LocalTime value={entry.savedAt} />
              </li>
            ))}
          </ol>
          <p className="method-note">Re-assessing adds a new version. Earlier versions are kept unchanged.</p>
        </div>

        <SavedAssessmentActions assessmentId={selected.assessmentId} input={input} result={result}
          reassessHref={reopen("reassess")} duplicateHref={reopen("duplicate")}
          versionCount={versions.length} deletable={deletable} />
      </div>
    </RegisterShell>
  );
}
