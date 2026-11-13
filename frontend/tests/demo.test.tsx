import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentWizard } from "../components/AssessmentWizard";
import { DemoAssessment } from "../components/DemoAssessment";
import { LoginForm } from "../components/LoginForm";
import { CHOICE_FIELDS, isAssessmentInput, validateDescription, validateQuestions } from "../lib/assessment";
import { DEMO_ASSESSMENT_ENDPOINT, DEMO_SCENARIOS } from "../lib/demo-scenarios";
import { DRAFT_KEY, saveDraft } from "../lib/session";
import { completeInput, stubAssessmentApi } from "./assessment-fixture";
import { expectNoViolations } from "./axe";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function pickSample(index: number) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(DEMO_SCENARIOS[index].title) }));
}

describe("sample scenarios", () => {
  it("covers each risk level once", () => {
    expect(DEMO_SCENARIOS.map((scenario) => scenario.expectedLevel).sort()).toEqual(["HIGH", "LOW", "MEDIUM"]);
    expect(new Set(DEMO_SCENARIOS.map((scenario) => scenario.id)).size).toBe(DEMO_SCENARIOS.length);
  });

  it.each(DEMO_SCENARIOS.map((scenario) => [scenario.title, scenario] as const))(
    "%s is a complete, valid assessment", (_title, scenario) => {
      expect(isAssessmentInput(scenario.input)).toBe(true);
      expect(validateDescription(scenario.input.description)).toBeNull();
      expect(validateQuestions(scenario.input)).toBeNull();
    },
  );
});

describe("demo mode", () => {
  it("fills every answer from a sample and moves to the questions", () => {
    stubAssessmentApi();
    render(<DemoAssessment />);
    pickSample(0);

    expect(screen.getByRole("heading", { level: 2, name: /how will the data be handled/i })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Started from the sample “${DEMO_SCENARIOS[0].title}”`))).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: true }).length).toBeGreaterThanOrEqual(CHOICE_FIELDS.length);
  });

  it("scores through the public endpoint without sending the description", async () => {
    const fetchMock = stubAssessmentApi();
    render(<DemoAssessment />);
    pickSample(0);
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));

    await screen.findByRole("heading", { level: 2, name: /high risk/i });
    expect(fetchMock.mock.calls[0][0]).toBe(DEMO_ASSESSMENT_ENDPOINT);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("description");
  });

  it("stores nothing and leaves a signed-in draft in the same tab untouched", () => {
    saveDraft(completeInput);
    const saved = sessionStorage.getItem(DRAFT_KEY);
    vi.useFakeTimers();
    render(<DemoAssessment />);
    expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe("");
    pickSample(2);
    // Past the draft-save debounce, but well short of the idle reset.
    vi.advanceTimersByTime(1000);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe(saved);
  });

  it("explains when the demo is rate limited", async () => {
    stubAssessmentApi(Response.json({ error: "rate_limited" }, { status: 429 }));
    render(<DemoAssessment />);
    pickSample(1);
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/wait a minute/i);
  });

  it("leaves the signed-in wizard without samples", () => {
    render(<AssessmentWizard />);
    expect(screen.queryByRole("region", { name: /start from a sample/i })).toBeNull();
  });

  it("labels demo mode and links to sign in", () => {
    render(<DemoAssessment />);
    expect(screen.getByText("Demo mode")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    const picker = screen.getByRole("region", { name: /start from a sample/i });
    expect(within(picker).getAllByRole("button")).toHaveLength(DEMO_SCENARIOS.length);
  });

  it("has no detectable accessibility violations on the first step", async () => {
    const { container } = render(<DemoAssessment />);
    await expectNoViolations(container);
  });
});

describe("sign-in page", () => {
  it("offers the sample assessment without an account", async () => {
    render(<LoginForm />);
    await waitFor(() => expect(screen.getByRole("link", { name: /try a sample assessment/i }).getAttribute("href")).toBe("/demo"));
  });
});
