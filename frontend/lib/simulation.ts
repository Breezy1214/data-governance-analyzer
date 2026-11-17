import {
  CHOICE_QUESTIONS,
  DATA_TYPE_LABELS,
  QUESTION_LABELS,
  hasUniqueValues,
  isRecord,
  isRiskLevel,
  isStringArray,
  postScoring,
  riskLevelFor,
  type AssessmentInput,
  type AssessmentResult,
  type RiskLevel,
} from "./assessment";

/**
 * What-if scoring for the safeguards a result recommends. The backend scores every combination, so the
 * browser only looks results up; it never computes a score. Nothing about a simulation is saved.
 */

export type RiskOutcome = { score: number; level: RiskLevel };

export type SimulatedSafeguard = {
  recommendationId: string;
  field: string;
  /** The answer once the safeguard is in place. */
  answer: string | string[];
  /** Points removed when it is the only safeguard applied. */
  points: number;
};

export type Simulation = {
  rulesVersion: string;
  mappingVersion: string;
  assessed: RiskOutcome;
  safeguards: SimulatedSafeguard[];
  /** outcomes[i] applies every safeguard whose bit is set in i; bit k is safeguards[k]. */
  outcomes: RiskOutcome[];
  plan: RiskOutcome & { applied: string[] };
};

export const SIMULATIONS_ENDPOINT = "/api/simulations";

function isRiskOutcome(value: unknown): value is RiskOutcome {
  return isRecord(value) && typeof value.score === "number" && Number.isInteger(value.score)
    && value.score >= 0 && value.score <= 100 && isRiskLevel(value.level) && value.level === riskLevelFor(value.score);
}

function isSafeguard(value: unknown): value is SimulatedSafeguard {
  return isRecord(value) && typeof value.recommendationId === "string" && typeof value.field === "string"
    && (typeof value.answer === "string" || isStringArray(value.answer))
    && typeof value.points === "number" && Number.isInteger(value.points) && value.points >= 0;
}

export function isSimulation(value: unknown): value is Simulation {
  if (!isRecord(value) || typeof value.rulesVersion !== "string" || typeof value.mappingVersion !== "string"
    || !isRiskOutcome(value.assessed) || !Array.isArray(value.safeguards) || !value.safeguards.every(isSafeguard)
    || !Array.isArray(value.outcomes) || !value.outcomes.every(isRiskOutcome)
    || !isRecord(value.plan) || !isStringArray(value.plan.applied) || !isRiskOutcome(value.plan)) return false;
  const ids = (value.safeguards as SimulatedSafeguard[]).map((item) => item.recommendationId);
  const outcomes = value.outcomes as RiskOutcome[];
  const assessed = value.assessed as RiskOutcome;
  return hasUniqueValues(ids) && outcomes.length === 2 ** ids.length
    && outcomes[0].score === assessed.score
    && (value.plan as Simulation["plan"]).applied.every((id) => ids.includes(id));
}

/** The simulation describes this result only when it re-derives the same score under the same rules. */
export function simulationMatches(simulation: Simulation, result: AssessmentResult): boolean {
  return simulation.rulesVersion === result.rulesVersion && simulation.assessed.score === result.score
    && simulation.assessed.level === result.level;
}

export function requestSimulation(input: AssessmentInput, endpoint: string, signal?: AbortSignal): Promise<Simulation> {
  return postScoring(input, endpoint, isSimulation, signal);
}

function maskOf(simulation: Simulation, applied: ReadonlySet<string>): number {
  return simulation.safeguards.reduce((mask, item, bit) => applied.has(item.recommendationId) ? mask | (1 << bit) : mask, 0);
}

export function outcomeFor(simulation: Simulation, applied: ReadonlySet<string>): RiskOutcome {
  return simulation.outcomes[maskOf(simulation, applied)];
}

/** Points this safeguard removes given the others applied: both scores come from the backend's outcomes. */
export function pointsRemoved(simulation: Simulation, applied: ReadonlySet<string>, id: string): number {
  const mask = maskOf(simulation, applied);
  const bit = 1 << simulation.safeguards.findIndex((item) => item.recommendationId === id);
  return simulation.outcomes[mask & ~bit].score - simulation.outcomes[mask | bit].score;
}

/** One line that turns the recommendations into a plan. */
export function planSummary(simulation: Simulation): string {
  const { plan, assessed } = simulation;
  if (!plan.applied.length) return "This use case is already LOW risk. The safeguards below would lower the score further.";
  const these = plan.applied.length === 1 ? "this safeguard" : `these ${plan.applied.length} safeguards`;
  if (plan.level === "LOW") return `Apply ${these} to reach LOW risk (${assessed.score} → ${plan.score}).`;
  return `Applying ${these} brings the score from ${assessed.score} to ${plan.score} (${plan.level}). `
    + "Reaching LOW would mean changing the use case itself: its data, partners, or purpose.";
}

/** The question a safeguard answers differently, and its new answer, in the questionnaire's words. */
export function answerChange(item: SimulatedSafeguard): { question: string; answer: string } {
  if (item.field === "dataTypes" && Array.isArray(item.answer)) {
    const labels: Record<string, string> = DATA_TYPE_LABELS;
    return { question: QUESTION_LABELS.dataTypes, answer: item.answer.map((value) => labels[value] ?? value).join(", ") };
  }
  const question = (CHOICE_QUESTIONS as Record<string, { legend: string; options: Record<string, string> }>)[item.field];
  const answer = String(item.answer);
  return { question: question?.legend ?? item.field, answer: question?.options[answer] ?? answer };
}

/** The what-if section of the PDF: what the simulator shows, or the backend's plan when nothing is toggled. */
export type SimulatedPlan = {
  source: "selected" | "plan";
  assessed: RiskOutcome;
  simulated: RiskOutcome;
  safeguards: { title: string; question: string; answer: string; points: number }[];
};

export function simulatedPlan(simulation: Simulation, applied: ReadonlySet<string>,
  result: AssessmentResult): SimulatedPlan | null {
  const source = applied.size ? "selected" : "plan";
  const chosen = applied.size ? applied : new Set(simulation.plan.applied);
  if (!chosen.size) return null;
  const titles = new Map(result.recommendations.map((item) => [item.id, item.title]));
  return {
    source,
    assessed: simulation.assessed,
    simulated: outcomeFor(simulation, chosen),
    safeguards: simulation.safeguards.filter((item) => chosen.has(item.recommendationId)).map((item) => ({
      title: titles.get(item.recommendationId) ?? item.recommendationId,
      ...answerChange(item),
      points: pointsRemoved(simulation, chosen, item.recommendationId),
    })),
  };
}
