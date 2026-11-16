"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AssessmentServiceError, scoringBody, type AssessmentInput, type AssessmentResult, type Recommendation } from "@/lib/assessment";
import {
  answerChange, outcomeFor, planSummary, pointsRemoved, requestSimulation, simulatedPlan, simulationMatches,
  type SimulatedPlan, type Simulation,
} from "@/lib/simulation";
import { RecommendationsView, ScoreRing } from "./AssessmentResultView";

type Props = {
  /** The answers that produced `result`. */
  input: AssessmentInput;
  result: AssessmentResult;
  endpoint: string;
  /** Receives what the report should include, or null when there is nothing to simulate. */
  onPlanChange?: (plan: SimulatedPlan | null) => void;
};

type Sort = "priority" | "impact";
const COUNT_UP_MS = 600;
const UNAVAILABLE = "The what-if simulator is unavailable right now.";
const RATE_LIMITED = "The what-if simulator is busy. Wait a minute, then try again.";

/** Recommendations with "Apply this safeguard" switches that re-score through the backend's what-if outcomes. */
export function SafeguardSimulator(props: Props) {
  // New answers or a new result start a fresh simulation with nothing applied.
  return <Simulator key={`${scoringBody(props.input)}|${props.result.assessedAt}`} {...props} />;
}

function Simulator({ input, result, endpoint, onPlanChange }: Props) {
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applied, setApplied] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<Sort>("priority");

  useEffect(() => {
    const controller = new AbortController();
    requestSimulation(input, endpoint, controller.signal)
      .then((value) => { setSimulation(value); setError(null); })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setError(failure instanceof AssessmentServiceError && failure.status === 429 ? RATE_LIMITED : UNAVAILABLE);
      });
    return () => controller.abort();
  }, [input, endpoint, attempt]);

  const matches = simulation !== null && simulationMatches(simulation, result);
  const usable = matches && simulation.safeguards.length > 0 ? simulation : null;
  const plan = useMemo(() => usable && simulatedPlan(usable, applied, result), [usable, applied, result]);
  useEffect(() => {
    onPlanChange?.(plan);
    return () => onPlanChange?.(null);
  }, [plan, onPlanChange]);
  const safeguards = useMemo(() => new Map(usable?.safeguards.map((item) => [item.recommendationId, item])), [usable]);

  const order = useMemo(() => {
    if (!usable || sort === "priority") return result.recommendations;
    const rank = new Map(usable.safeguards.map((item, index) => [item.recommendationId, index]));
    const rankOf = (item: Recommendation) => rank.get(item.id) ?? Infinity;
    return result.recommendations.toSorted((a, b) => rankOf(a) - rankOf(b) || a.priority - b.priority);
  }, [usable, sort, result.recommendations]);

  const toggle = (id: string) => setApplied((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const note = (): React.ReactNode => {
    if (error) return (
      <p className="simulator-note" role="alert">
        {error} <button className="secondary" type="button" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</button>
      </p>
    );
    if (!simulation) return <p className="simulator-note">Preparing the what-if simulator…</p>;
    if (!matches) return <p className="simulator-note">What-if simulation uses the current scoring rules, so it isn’t available for this result.</p>;
    return <p className="simulator-note">None of these recommendations changes a scored answer, so there is nothing to simulate.</p>;
  };

  return (
    <RecommendationsView
      result={result}
      order={order}
      toolbar={usable ? <>
        <SimulatorPanel simulation={usable} applied={applied}
          onApplyPlan={() => setApplied(new Set(usable.plan.applied))} onClear={() => setApplied(new Set())} />
        <div className="sort-control" role="group" aria-label="Sort recommendations">
          <span>Sort by</span>
          <button type="button" className="choice" aria-pressed={sort === "priority"} onClick={() => setSort("priority")}>Priority</button>
          <button type="button" className="choice" aria-pressed={sort === "impact"} onClick={() => setSort("impact")}>Biggest risk reduction</button>
        </div>
      </> : note()}
      safeguard={usable ? (item) => {
        const safeguard = safeguards.get(item.id);
        if (!safeguard) return null;
        const points = pointsRemoved(usable, applied, item.id);
        const change = answerChange(safeguard);
        return (
          <div className="safeguard-control" data-applied={applied.has(item.id) || undefined}>
            <label className="safeguard-toggle">
              <input type="checkbox" role="switch" checked={applied.has(item.id)} onChange={() => toggle(item.id)}
                aria-describedby={`safeguard-${item.id}`} />
              <span>Apply this safeguard<span className="sr-only">: {item.title}</span></span>
            </label>
            <b className="safeguard-points">{points ? `−${points} points` : "0 points at this score"}</b>
            <span className="safeguard-answer" id={`safeguard-${item.id}`}>Changes the answer: {change.question} → {change.answer}</span>
          </div>
        );
      } : undefined}
    />
  );
}

function SimulatorPanel({ simulation, applied, onApplyPlan, onClear }: {
  simulation: Simulation;
  applied: ReadonlySet<string>;
  onApplyPlan: () => void;
  onClear: () => void;
}) {
  const { assessed, plan } = simulation;
  const current = outcomeFor(simulation, applied);
  const shown = useCountUp(current.score);
  const removed = assessed.score - current.score;
  const planApplied = plan.applied.length === applied.size && plan.applied.every((id) => applied.has(id));
  const panel = useRef<HTMLElement>(null);
  useStickyOffset(panel);

  return (
    <section ref={panel} className="card simulator" aria-labelledby="simulator-heading">
      <div className="simulator-head">
        <h4 id="simulator-heading">What-if safeguard simulator</h4>
        <span className="badge">Not saved</span>
      </div>
      <div className="simulator-scores">
        <div className="simulator-assessed" data-risk={assessed.level.toLowerCase()}>
          <span className="simulator-label">Assessed score</span>
          <b className="risk-label"><span className="risk-icon" aria-hidden="true" />{assessed.score}/100 · {assessed.level}</b>
          <span className="method-note">This is the record. Simulating never changes it.</span>
        </div>
        <div className="simulator-simulated" data-risk={current.level.toLowerCase()}>
          <ScoreRing score={current.score} display={<span aria-hidden="true">{shown}</span>} />
          <div>
            <span className="simulator-label">Simulated score</span>
            <b key={current.level} className="risk-label risk-pill level-change">
              <span className="risk-icon" aria-hidden="true" />{current.level} RISK
            </b>
            <span className="simulator-delta">{applied.size ? `−${removed} points` : "No safeguards applied"}</span>
          </div>
        </div>
      </div>
      <p className="simulator-summary">{planSummary(simulation)}</p>
      <div className="simulator-actions">
        {plan.applied.length > 0 && <button className="secondary" type="button" disabled={planApplied} onClick={onApplyPlan}>Apply this plan</button>}
        <button className="secondary" type="button" disabled={!applied.size} onClick={onClear}>Clear</button>
      </div>
      <p className="sr-only" role="status">Simulated score {current.score} out of 100, {current.level.toLowerCase()} risk.</p>
    </section>
  );
}

/** Publishes the pinned panel's height, so the page scrolls focused items clear of it (see globals.css). */
function useStickyOffset(panel: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = panel.current;
    if (!element || typeof ResizeObserver !== "function") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--simulator-height", `${element.getBoundingClientRect().height}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--simulator-height");
    };
  }, [panel]);
}

/** Counts from the last shown value to `target`, or jumps there when motion is reduced. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const last = useRef(target);
  useEffect(() => {
    const from = last.current;
    const instant = from === target || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = instant ? 1 : Math.min(1, (now - started) / COUNT_UP_MS);
      last.current = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      setShown(last.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
