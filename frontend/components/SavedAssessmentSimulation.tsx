"use client";

import { useState } from "react";
import type { AssessmentInput, AssessmentResult } from "@/lib/assessment";
import { SIMULATIONS_ENDPOINT, type SimulatedPlan } from "@/lib/simulation";
import { SafeguardSimulator } from "./SafeguardSimulator";
import { SavedAssessmentActions, type SavedAssessmentActionsProps } from "./SavedAssessmentActions";

/** A saved result's recommendations with the what-if simulator. Simulating only re-scores; the saved version is untouched. */
export function SavedAssessmentSimulation({ input, result, actions, children }: {
  input: AssessmentInput;
  result: AssessmentResult;
  actions: Omit<SavedAssessmentActionsProps, "input" | "result" | "simulated">;
  /** Rendered between the recommendations and the actions. */
  children: React.ReactNode;
}) {
  const [simulated, setSimulated] = useState<SimulatedPlan | null>(null);
  return <>
    <SafeguardSimulator input={input} result={result} endpoint={SIMULATIONS_ENDPOINT} onPlanChange={setSimulated} />
    {children}
    <SavedAssessmentActions {...actions} input={input} result={result} simulated={simulated} />
  </>;
}
