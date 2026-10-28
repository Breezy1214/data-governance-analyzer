import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentWizard } from "../components/AssessmentWizard";
import { BINARY_FIELDS, EMPTY_INPUT, QUESTION_LABELS } from "../lib/assessment";
import { CAPABILITY_COPY } from "../lib/recommendations";
import { DRAFT_KEY, IDLE_TIMEOUT_MS, saveDraft } from "../lib/session";
import { assessmentResult, hangingFetch, stubAssessmentApi } from "./assessment-fixture";

/**
 * Accessibility checks for the assessment flow (SCRUM-17).
 *
 * axe-core catches the machine-checkable WCAG failures. Colour contrast
 * cannot be judged in jsdom, so it is excluded here and audited against
 * the stylesheet instead; see docs/accessibility-review.md.
 */

const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  rules: { "color-contrast": { enabled: false } },
};

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, AXE_OPTIONS);
  const summary = results.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
  );
  expect(summary).toEqual([]);
}

function describeUseCase(description = "Share loyalty member emails with a partner brand for campaign measurement.") {
  fireEvent.change(screen.getByLabelText(/use-case description/i), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

function completeQuestions(dataType = /email addresses/i) {
  fireEvent.click(screen.getByRole("button", { name: dataType }));
  BINARY_FIELDS.forEach((key) => {
    const group = screen.getByRole("group", { name: new RegExp(QUESTION_LABELS[key].slice(0, 24), "i") });
    fireEvent.click(within(group).getByRole("button", { name: "Yes" }));
  });
}

function answerQuestions(dataType?: RegExp, description?: string) {
  describeUseCase(description);
  completeQuestions(dataType);
}

beforeEach(() => {
  window.sessionStorage.clear?.();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
  stubAssessmentApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assessment flow accessibility", () => {
  it("restores drafts across repeated mounts in Strict Mode", async () => {
    const draft = { ...EMPTY_INPUT, description: "Share loyalty member emails with a partner brand." };
    saveDraft(draft);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const view = render(<StrictMode><AssessmentWizard /></StrictMode>);
      await waitFor(() => expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe(draft.description));
      expect(JSON.parse(window.sessionStorage.getItem(DRAFT_KEY)!).input).toEqual(draft);
      view.unmount();
    }
  });

  it("reports backend failure and permits retry without producing a local score", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/service is unavailable/i);
    expect(screen.queryByText(/what drives this score/i)).toBeNull();
    expect(screen.getByRole("button", { name: /assess risk/i }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
  });

  it("explains rejected answers separately from service downtime", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 422 }));
    render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/could not accept these answers/i);
    expect(screen.queryByText(/service is unavailable/i)).toBeNull();
  });

  it("cancels scoring when answers change and ignores a late response", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    fireEvent.click(screen.getByRole("button", { name: /phone numbers/i }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(new Response(JSON.stringify(assessmentResult))));
    expect(screen.queryByText(/what drives this score/i)).toBeNull();
    expect(screen.getByRole("button", { name: /assess risk/i }).hasAttribute("disabled")).toBe(false);
  });

  it("aborts scoring and clears the draft on idle expiry", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(hangingFetch);
    render(<AssessmentWizard />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS));
    expect(screen.getByText(/session expired/i)).toBeTruthy();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("discards a document import that finishes after idle expiry", async () => {
    vi.useFakeTimers();
    let finishReading!: (text: string) => void;
    const reading = new Promise<string>((done) => { finishReading = done; });
    // Only the members the text reader touches; jsdom's File cannot read its contents.
    const file = { name: "brief.txt", size: 20, slice: () => ({ text: () => reading }) } as unknown as File;
    const { container } = render(<AssessmentWizard />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(container.querySelector("#document-upload")!, { target: { files: [file] } });
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS));
    await act(async () => finishReading("Late private description."));
    expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe("");
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("aborts scoring when the wizard unmounts", async () => {
    vi.mocked(fetch).mockImplementationOnce(hangingFetch);
    const view = render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await act(async () => view.unmount());
    expect(signal.aborted).toBe(true);
  });

  it("has no axe violations on the description step", async () => {
    const { container } = render(<AssessmentWizard />);
    await expectNoViolations(container);
  });

  it("offers a skip link to the assessment", () => {
    render(<AssessmentWizard />);
    const skip = screen.getByRole("link", { name: /skip to the assessment/i });
    expect(skip.getAttribute("href")).toBe("#assessment");
    expect(document.querySelector("#assessment")).not.toBeNull();
  });

  it("exposes the document upload with a labelled control and help text", async () => {
    const { container } = render(<AssessmentWizard />);
    const input = container.querySelector("#document-upload") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute("accept")).toContain(".pdf");
    expect(input.getAttribute("aria-describedby")).toBe("upload-help");
    expect(document.querySelector("#upload-help")?.textContent).toMatch(/stays on your device/i);
    expect(screen.getByRole("button", { name: /choose file/i })).toBeTruthy();
    await expectNoViolations(container);
  });

  it("announces the current step through a status region", () => {
    render(<AssessmentWizard />);
    expect(screen.getByRole("status").textContent).toContain("Step 1 of 4");
  });

  it("keeps every step reachable and accessible through the whole flow", async () => {
    const { container } = render(<AssessmentWizard />);

    describeUseCase();
    await screen.findByText(/how will the data be handled/i);
    await expectNoViolations(container);
    completeQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));

    await screen.findByText(/what drives this score/i);
    await expectNoViolations(container);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));

    await screen.findByText(/controls before approval/i);
    expect(screen.getByRole("heading", { name: "General safeguards" })).toBeTruthy();
    expect(container.querySelector(".capability-list .recommendation-reason")?.textContent).toMatch(/Baseline control/);
    expect(screen.getByText(/Recommendation mapping v1.1: stakeholder approved/)).toBeTruthy();
    expect(screen.getByText("Recommendation mapping version")).toBeTruthy();
    await expectNoViolations(container);
  });

  it("explains each recommended control in approved plain language", async () => {
    const { container } = render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));

    await waitFor(() => expect(container.querySelector(".capability-list")).not.toBeNull());
    // Each capability appears once: beside the safeguard it delivers, or in the panel.
    assessmentResult.karlsgateRecommendations.forEach((capability) => {
      expect(CAPABILITY_COPY[capability.label]).toBe(capability.text);
      expect(screen.getAllByText(capability.label)).toHaveLength(1);
      expect(screen.getAllByText(capability.text)).toHaveLength(1);
    });
    const list = container.querySelector(".recommendation-list") as HTMLElement;
    expect(within(list).getByText("Protected matching")).toBeTruthy();
    expect(within(container.querySelector(".capability-list") as HTMLElement).getByText("Governance policy execution")).toBeTruthy();

    expect(screen.getByText(/HIGH RISK · 100\/100/i)).toBeTruthy();
    assessmentResult.recommendationDetails.forEach((recommendation) => {
      expect(screen.getByText(recommendation.title)).toBeTruthy();
      expect(screen.getByText(recommendation.rationale, { exact: false })).toBeTruthy();
    });
    expect(screen.getAllByText(/Triggered by:/i)).toHaveLength(assessmentResult.recommendationDetails.length);
  });

  it("does not rely on colour alone to convey the risk level", async () => {
    const { container } = render(<AssessmentWizard />);
    answerQuestions(/health information/i, "Share patient records with an external analytics vendor for modelling.");
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));

    await screen.findByText(/what drives this score/i);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/high risk/);
    expect(container.querySelector('[data-risk="high"] h2 .risk-icon')).not.toBeNull();
  });
});
