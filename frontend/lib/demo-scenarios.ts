import scenarios from "./demo-scenarios.json";
import type { AssessmentInput, RiskLevel } from "./assessment";

export type DemoScenario = {
  id: string;
  title: string;
  sector: string;
  summary: string;
  /** Checked against the backend rules by backend/tests/test_demo.py. */
  expectedLevel: RiskLevel;
  expectedScore: number;
  input: AssessmentInput;
};

/** Sample use cases for the public demo. Shared with the backend tests as JSON so they can't drift from the rules. */
export const DEMO_SCENARIOS = scenarios as DemoScenario[];

export const DEMO_ASSESSMENT_ENDPOINT = "/api/demo/assessments";
