"use client";

import Link from "next/link";
import { DEMO_ASSESSMENT_ENDPOINT, DEMO_SCENARIOS } from "@/lib/demo-scenarios";
import { AssessmentWizard, type Prefill, type Stat } from "./AssessmentWizard";

const DEMO_STATS: Stat[] = [
  { title: "Sample scenarios", badge: "Demo", value: DEMO_SCENARIOS.length, detail: <>From <b>low</b> to <b>high</b> risk</> },
  { title: "Answers stored", badge: "Demo", value: 0, detail: <>Nothing is <b>saved</b></> },
];

function ScenarioPicker({ prefill }: { prefill: Prefill }) {
  return (
    <section className="card scenario-picker" aria-labelledby="scenario-heading">
      <h3 className="card-title" id="scenario-heading">Start from a sample</h3>
      <p className="lede">Pick a scenario to fill in every answer, or describe your own use case below.</p>
      <ul className="scenario-list">
        {DEMO_SCENARIOS.map((scenario) => (
          <li key={scenario.id}>
            <button type="button" className="choice scenario" onClick={() => prefill(scenario.input, scenario.title)}>
              <span className="badge">{scenario.sector}</span>
              <b>{scenario.title}</b>
              <span>{scenario.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The public sample assessment: scored by the rate-limited demo endpoint, with nothing stored. */
export function DemoAssessment() {
  return <AssessmentWizard
    endpoint={DEMO_ASSESSMENT_ENDPOINT}
    keepDrafts={false}
    privacyStats={DEMO_STATS}
    intro={ScenarioPicker}
    account={
      <div className="account-controls">
        <span className="badge">Demo mode</span>
        <Link href="/login">Sign in</Link>
        <Link href="/signup">Create account</Link>
      </div>
    } />;
}
