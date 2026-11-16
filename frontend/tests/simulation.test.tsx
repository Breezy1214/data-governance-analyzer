import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoAssessment } from "../components/DemoAssessment";
import { SafeguardSimulator } from "../components/SafeguardSimulator";
import { SavedAssessmentSimulation } from "../components/SavedAssessmentSimulation";
import type { AssessmentResult } from "../lib/assessment";
import { DEMO_SCENARIOS, DEMO_SIMULATION_ENDPOINT } from "../lib/demo-scenarios";
import { SIMULATION_HEADING, buildReportModel, downloadAssessmentReport, renderAssessmentPdf } from "../lib/report";
import {
  SIMULATIONS_ENDPOINT, answerChange, isSimulation, outcomeFor, planSummary, pointsRemoved, requestSimulation,
  simulatedPlan, simulationMatches, type Simulation,
} from "../lib/simulation";
import { expectNoViolations } from "./axe";
import clinic from "./fixtures/clinic-simulation.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../lib/report", async (original) => ({
  ...await original<typeof import("../lib/report")>(),
  downloadAssessmentReport: vi.fn(async () => {}),
}));

// Recorded from the backend; backend/tests/test_safeguards.py keeps it equal to the current rules.
const result = clinic.result as AssessmentResult;
const simulation = clinic.simulation as Simulation;
const input = DEMO_SCENARIOS.find((item) => item.id === clinic.scenario)!.input;
const ids = (...names: string[]) => new Set(names);

/** A capped case: 106 raw points shown as 100, so a safeguard can remove fewer points alone than with others. */
const capped: Simulation = {
  rulesVersion: "2.0",
  mappingVersion: "2.0",
  assessed: { score: 100, level: "HIGH" },
  safeguards: [
    { recommendationId: "A", field: "custodyChange", answer: "no", points: 4 },
    { recommendationId: "B", field: "secondaryUse", answer: "no", points: 2 },
  ],
  outcomes: [
    { score: 100, level: "HIGH" }, { score: 96, level: "HIGH" }, { score: 98, level: "HIGH" }, { score: 88, level: "HIGH" },
  ],
  plan: { applied: ["A", "B"], score: 88, level: "HIGH" },
};

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected request to ${String(url)}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("simulation results", () => {
  it("accepts the backend's simulation and rejects inconsistent ones", () => {
    expect(isSimulation(simulation)).toBe(true);
    expect(isSimulation(capped)).toBe(true);
    expect(isSimulation({ ...simulation, outcomes: simulation.outcomes.slice(1) })).toBe(false);
    expect(isSimulation({ ...capped, outcomes: [{ score: 10, level: "HIGH" }, ...capped.outcomes.slice(1)] })).toBe(false);
    expect(isSimulation({ ...capped, plan: { ...capped.plan, applied: ["C"] } })).toBe(false);
  });

  it("looks up every combination instead of computing scores", () => {
    expect(outcomeFor(simulation, ids())).toEqual({ score: 86, level: "HIGH" });
    expect(outcomeFor(simulation, ids("AVOID_READABLE_IDENTIFIERS", "LIMIT_CUSTODY_CHANGES"))).toEqual({ score: 58, level: "MEDIUM" });
    expect(outcomeFor(simulation, new Set(simulation.plan.applied))).toEqual({ score: 32, level: "MEDIUM" });
  });

  it("shows the points each safeguard removes given the others, from backend outcomes", () => {
    expect(pointsRemoved(capped, ids(), "B")).toBe(2);
    expect(pointsRemoved(capped, ids("A"), "B")).toBe(8);
    expect(pointsRemoved(capped, ids("A", "B"), "A")).toBe(10);
    for (const item of simulation.safeguards) expect(pointsRemoved(simulation, ids(), item.recommendationId)).toBe(item.points);
  });

  it("summarizes the plan", () => {
    expect(planSummary(simulation)).toBe("Applying these 5 safeguards brings the score from 86 to 32 (MEDIUM). "
      + "Reaching LOW would mean changing the use case itself: its data, partners, or purpose.");
    const reachable: Simulation = { ...capped, assessed: { score: 34, level: "MEDIUM" },
      outcomes: [{ score: 34, level: "MEDIUM" }, { score: 24, level: "LOW" }, { score: 26, level: "LOW" }, { score: 16, level: "LOW" }],
      plan: { applied: ["A"], score: 24, level: "LOW" } };
    expect(planSummary(reachable)).toBe("Apply this safeguard to reach LOW risk (34 → 24).");
    expect(planSummary({ ...reachable, plan: { ...reachable.plan, applied: ["A", "B"] } })).toMatch(/^Apply these 2 safeguards to reach LOW/);
  });

  it("describes each answer change in the questionnaire's words", () => {
    const byId = Object.fromEntries(simulation.safeguards.map((item) => [item.recommendationId, item]));
    expect(answerChange(byId.VERIFY_RULE_ENFORCEMENT)).toEqual(
      { question: "Who controls the environment and enforces the rules?", answer: "Your organization" });
    expect(answerChange(byId.DE_IDENTIFY_SENSITIVE_RECORDS)).toEqual(
      { question: "What information is involved?", answer: "Names, Phone numbers" });
  });

  it("only describes the result it re-derives", () => {
    expect(simulationMatches(simulation, result)).toBe(true);
    expect(simulationMatches(simulation, { ...result, score: 87 })).toBe(false);
    expect(simulationMatches(simulation, { ...result, rulesVersion: "1.0" })).toBe(false);
  });

  it("sends only the scored answers", async () => {
    const fetchMock = stubFetch({ [SIMULATIONS_ENDPOINT]: json(simulation) });
    expect(await requestSimulation(input, SIMULATIONS_ENDPOINT)).toEqual(simulation);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("description");
    stubFetch({ [SIMULATIONS_ENDPOINT]: json({ ...simulation, outcomes: [] }) });
    await expect(requestSimulation(input, SIMULATIONS_ENDPOINT)).rejects.toThrow(/invalid/);
  });
});

describe("the simulated plan in the report", () => {
  it("uses the toggled safeguards, or the backend plan when none are", () => {
    const selected = simulatedPlan(simulation, ids("LIMIT_CUSTODY_CHANGES"), result)!;
    expect(selected.source).toBe("selected");
    expect(selected.simulated).toEqual({ score: 76, level: "HIGH" });
    expect(selected.safeguards).toEqual([expect.objectContaining({ title: "Limit changes of custody", points: 10 })]);
    expect(simulatedPlan(simulation, ids(), result)).toMatchObject({ source: "plan", simulated: { score: 32 } });
    expect(simulatedPlan({ ...simulation, plan: { ...simulation.assessed, applied: [] } }, ids(), result)).toBeNull();
  });

  it("is a separate section on its own page, after the assessment", async () => {
    const plan = simulatedPlan(simulation, ids(), result)!;
    const model = buildReportModel(input, result, plan);
    const headings = model.sections.map((section) => section.heading);
    const start = headings.indexOf(SIMULATION_HEADING);
    expect(start).toBeGreaterThan(headings.indexOf("Recommended actions"));
    expect(model.sections[start].newPage).toBe(true);
    expect(model.risk).toEqual({ level: "HIGH", score: 86 });
    expect(JSON.stringify(model.sections[start])).toContain("86 out of 100 (HIGH), remains the record");
    const simulationText = JSON.stringify(model.sections.slice(start));
    expect(simulationText).toContain("Stop handing over readable identifiers: removes 18 points.");
    expect(buildReportModel(input, result).sections.map((section) => section.heading)).not.toContain(SIMULATION_HEADING);

    const pages = async (simulated: typeof plan | null) =>
      (await renderAssessmentPdf(buildReportModel(input, result, simulated))).getNumberOfPages();
    expect(await pages(plan)).toBe(await pages(null) + 1);
  });
});

describe("the safeguard simulator", () => {
  function renderSimulator(endpoint = DEMO_SIMULATION_ENDPOINT, shown = result) {
    const onPlanChange = vi.fn();
    const view = render(<SafeguardSimulator input={input} result={shown} endpoint={endpoint} onPlanChange={onPlanChange} />);
    return { ...view, onPlanChange };
  }
  const status = () => screen.getByText(/^Simulated score \d+ out of 100/);
  const toggle = (title: string) => fireEvent.click(screen.getByRole("switch", { name: new RegExp(title) }));

  it("re-scores as safeguards are toggled while the assessed score stays", async () => {
    stubFetch({ [DEMO_SIMULATION_ENDPOINT]: json(simulation) });
    const { container, onPlanChange } = renderSimulator();
    const panel = await screen.findByRole("region", { name: /what-if safeguard simulator/i });
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    expect(status().textContent).toBe("Simulated score 86 out of 100, high risk.");

    toggle("Stop handing over readable identifiers");
    expect(status().textContent).toBe("Simulated score 68 out of 100, high risk.");
    toggle("Limit changes of custody");
    expect(status().textContent).toBe("Simulated score 58 out of 100, medium risk.");
    expect(within(panel).getByText("−28 points")).toBeTruthy();
    expect(within(panel).getByText("86/100 · HIGH")).toBeTruthy();
    expect(screen.getByText("HIGH RISK · 86/100")).toBeTruthy();
    expect(onPlanChange).toHaveBeenLastCalledWith(expect.objectContaining({ source: "selected", simulated: { score: 58, level: "MEDIUM" } }));

    fireEvent.click(screen.getByRole("button", { name: "Apply this plan" }));
    expect(status().textContent).toBe("Simulated score 32 out of 100, medium risk.");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(status().textContent).toBe("Simulated score 86 out of 100, high risk.");
    await expectNoViolations(container);
  });

  it("shows the backend's points and sorts by risk reduction", async () => {
    stubFetch({ [DEMO_SIMULATION_ENDPOINT]: json(simulation) });
    renderSimulator();
    await screen.findByRole("region", { name: /what-if/i });
    const titles = () => screen.getAllByRole("heading", { level: 4 }).map((item) => item.textContent).slice(1, 6);
    expect(titles()).toEqual(["Stop handing over readable identifiers", "De-identify sensitive records",
      "Limit changes of custody", "Verify who enforces the rules", "Agree what gets deleted afterward"]);
    fireEvent.click(screen.getByRole("button", { name: "Biggest risk reduction" }));
    expect(titles()).toEqual(["Stop handing over readable identifiers", "De-identify sensitive records",
      "Limit changes of custody", "Agree what gets deleted afterward", "Verify who enforces the rules"]);
    expect(screen.getAllByText(/^−\d+ points$/).map((item) => item.textContent)).toEqual(
      ["−18 points", "−12 points", "−10 points", "−8 points", "−6 points"]);
  });

  it("offers a retry when the simulator is unavailable", async () => {
    const fetchMock = stubFetch({ [DEMO_SIMULATION_ENDPOINT]: json({ error: "rate_limited" }, 429) });
    renderSimulator();
    expect((await screen.findByRole("alert")).textContent).toMatch(/busy/);
    fetchMock.mockImplementation(async () => json(simulation)());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("switch")).toHaveLength(5);
  });

  it("shows no switches for a result the simulation doesn't describe", async () => {
    stubFetch({ [DEMO_SIMULATION_ENDPOINT]: json(simulation) });
    renderSimulator(DEMO_SIMULATION_ENDPOINT, { ...result, rulesVersion: "1.0" });
    expect(await screen.findByText(/isn’t available for this result/)).toBeTruthy();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

describe("where the simulator runs", () => {
  it("uses the public endpoint in demo mode", async () => {
    const fetchMock = stubFetch({ "/api/demo/assessments": json(result), [DEMO_SIMULATION_ENDPOINT]: json(simulation) });
    render(<DemoAssessment />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(DEMO_SCENARIOS[0].title) }));
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    fireEvent.click(await screen.findByRole("button", { name: /see recommendations/i }));
    expect(await screen.findAllByRole("switch")).toHaveLength(5);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/demo/assessments", DEMO_SIMULATION_ENDPOINT]);
  });

  it("only re-scores a saved assessment, and adds the plan to its report", async () => {
    const fetchMock = stubFetch({ [SIMULATIONS_ENDPOINT]: json(simulation) });
    render(
      <SavedAssessmentSimulation input={input} result={result} actions={{
        assessmentId: "4a1b8c4e-0000-4000-8000-000000000001", reassessHref: "/r", duplicateHref: "/d",
        versionCount: 1, deletable: true,
      }}><p>Record</p></SavedAssessmentSimulation>);
    fireEvent.click(await screen.findByRole("switch", { name: /Limit changes of custody/ }));
    fireEvent.click(screen.getByRole("button", { name: /download report/i }));
    await waitFor(() => expect(downloadAssessmentReport).toHaveBeenCalled());
    expect(vi.mocked(downloadAssessmentReport).mock.calls[0][2]).toMatchObject({ source: "selected", simulated: { score: 76 } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SIMULATIONS_ENDPOINT]);
  });
});
