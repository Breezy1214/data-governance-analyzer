import type { Metadata } from "next";
import Link from "next/link";
import { AssessmentRecord, ScoreBreakdown } from "@/components/AssessmentResultView";
import { LocalTime } from "@/components/LocalTime";
import { RegisterShell } from "@/components/RegisterShell";
import { ReviewControls } from "@/components/ReviewControls";
import { SavedAssessmentSimulation } from "@/components/SavedAssessmentSimulation";
import { type AssessmentPageProps, loadAssessmentPage } from "@/lib/register-page";
import {
  DESCRIPTION_NOT_SAVED, REGISTER_PATH, STATUS_LABELS, assessmentPath, assessmentTitle, isDeletable,
} from "@/lib/register";
import { approvalSignOff } from "@/lib/review";
import { reviewContext, reviewWorkspaces } from "@/lib/review-server";

export const metadata: Metadata = { title: "Saved assessment · Data Governance Readiness Analyzer" };

export default async function SavedAssessment(props: AssessmentPageProps) {
  const { accessToken, session, versions, selected, latest, isOwner } = await loadAssessmentPage(props);
  const { input, result } = selected;
  const [context, workspaces] = await Promise.all([
    reviewContext(accessToken, selected.id), isOwner ? reviewWorkspaces(accessToken) : [],
  ]);
  const title = assessmentTitle(input);
  // Deleting removes every version, so it is offered only while every version is still a private draft.
  const deletable = versions.every((entry) => isDeletable(entry.status));
  const reopen = (path: string) => `${REGISTER_PATH}/${selected.assessmentId}/${path}?version=${selected.version}`;

  return (
    <RegisterShell email={session.user.email} section="Saved assessment" parent={{ href: REGISTER_PATH, label: "My assessments" }}
      current={REGISTER_PATH} title={title}
      intro={<>Version {selected.version} of {versions.length} · {STATUS_LABELS[selected.status]} · Saved <LocalTime value={selected.savedAt} /></>}>
      <div className="step-panel risk-result" data-risk={result.level.toLowerCase()}>
        {selected.version !== latest.version && (
          <p className="sample-note">
            This is an earlier version. <Link href={assessmentPath(selected.assessmentId)}>See the latest (version {latest.version})</Link>.
          </p>
        )}
        <h2>The proposed use case is <em><span className="risk-icon" aria-hidden="true" />{result.level.toLowerCase()} risk.</em></h2>
        <ScoreBreakdown result={result} />
        <SavedAssessmentSimulation input={input} result={result} actions={{
          assessmentId: selected.assessmentId, reassessHref: reopen("reassess"), duplicateHref: reopen("duplicate"),
          versionCount: versions.length, deletable, isOwner, signOff: approvalSignOff(selected.status, context.events),
        }}>
          <ReviewControls versionId={selected.id} status={selected.status} context={context} isOwner={isOwner} workspaces={workspaces} />
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
        </SavedAssessmentSimulation>
      </div>
    </RegisterShell>
  );
}
