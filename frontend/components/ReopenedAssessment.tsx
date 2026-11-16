import { AuthenticatedAssessment } from "./AuthenticatedAssessment";
import { type AssessmentPageProps, loadAssessmentPage } from "@/lib/register-page";
import { assessmentTitle } from "@/lib/register";

/** Re-assessing adds versions to the same assessment; duplicating starts a new one from the same answers. */
export async function ReopenedAssessment({ page, mode }: { page: AssessmentPageProps; mode: "reassess" | "duplicate" }) {
  const { session, selected, latest } = await loadAssessmentPage(page);
  const title = assessmentTitle(selected.input);
  const notice = mode === "reassess"
    ? <>Re-assessing “{title}” from version {selected.version}. The new result is saved as version {latest.version + 1},
        and earlier versions are kept.</>
    : <>Starting a new assessment from “{title}” (version {selected.version}). The original is unchanged.</>;
  return <AuthenticatedAssessment session={session} reopened={{
    input: selected.input,
    saveTo: mode === "reassess" ? selected.assessmentId : null,
    notice: <>{notice} Descriptions aren’t saved, so describe the use case again.</>,
  }} />;
}
