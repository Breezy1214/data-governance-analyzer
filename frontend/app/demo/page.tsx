import type { Metadata } from "next";
import { DemoAssessment } from "@/components/DemoAssessment";

export const metadata: Metadata = { title: "Sample assessment · Data Governance Readiness Analyzer" };

export default function Demo() {
  return <DemoAssessment />;
}
