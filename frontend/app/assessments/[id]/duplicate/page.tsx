import type { Metadata } from "next";
import { ReopenedAssessment } from "@/components/ReopenedAssessment";
import type { AssessmentPageProps } from "@/lib/register-page";

export const metadata: Metadata = { title: "Duplicate · Data Governance Readiness Analyzer" };

export default function Duplicate(props: AssessmentPageProps) {
  return <ReopenedAssessment page={props} mode="duplicate" />;
}
