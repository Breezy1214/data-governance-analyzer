import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentWizard } from "../components/AssessmentWizard";
import { CHOICE_FIELDS, CHOICE_QUESTIONS, EMPTY_INPUT, QUESTION_LABELS } from "../lib/assessment";
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
  const regulations = screen.getByRole("group", { name: QUESTION_LABELS.regulations });
  fireEvent.click(within(regulations).getByRole("button", { name: "Not sure" }));
  CHOICE_FIELDS.forEach((key) => {
    const group = screen.getByRole("group", { name: CHOICE_QUESTIONS[key].legend });
    const [first] = Object.values(CHOICE_QUESTIONS[key].options);
    fireEvent.click(within(group).getByRole("button", { name: first }));
  });
}

function answerQuestions(dataType?: RegExp, description?: string) {
  describeUseCase(description);
  completeQuestions(dataType);
}

beforeEach(() => {
  window.sessionStorage.clear?.();
  stubAssessmentApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assessment flow accessibility", () => {
  it("handles an unauthorized assessment in the component and clears its draft", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    const onUnauthorized = vi.fn();
    render(<AssessmentWizard onUnauthorized={onUnauthorized} />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByText(/what drives this score/i)).toBeNull();
  });
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
    expect(screen.getByRole("heading", { name: "Recommended actions" })).toBeTruthy();
    expect(screen.getByText(/Recommendation catalog v2.0: approved. Sources checked November 4, 2026/)).toBeTruthy();
    expect(screen.getByText("Recommendation catalog version")).toBeTruthy();
    await expectNoViolations(container);
  });

  it("shows recommendations as the app's own advice and links regulatory sources", async () => {
    render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));
    await screen.findByText(/controls before approval/i);

    expect(screen.getByRole("heading", { name: "Regulatory reference" })).toBeTruthy();

    const [reference] = assessmentResult.recommendations[0].references;
    const link = screen.getByRole("link", { name: new RegExp(`Source: ${reference.sourceTitle.slice(0, 13)}`) });
    expect(link.getAttribute("href")).toBe(reference.sourceUrl);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    expect(screen.getByText(/HIGH RISK · 100\/100/i)).toBeTruthy();
    assessmentResult.recommendations.forEach((recommendation) => {
      expect(screen.getByText(recommendation.title)).toBeTruthy();
      expect(screen.getByText(recommendation.rationale, { exact: false })).toBeTruthy();
    });
    expect(screen.getAllByText(/Based on your answers:/i)).toHaveLength(2);
    expect(screen.getByText("Applies to every assessment.")).toBeTruthy();
    expect(screen.getByText("3 recommendations")).toBeTruthy();
  });

  it("replaces None of these or Not sure when a named rule is chosen", () => {
    render(<AssessmentWizard />);
    describeUseCase();
    const group = screen.getByRole("group", { name: QUESTION_LABELS.regulations });
    const button = (name: string) => within(group).getByRole("button", { name });
    fireEvent.click(button("None of these"));
    expect(button("None of these").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("HIPAA"));
    expect(button("None of these").getAttribute("aria-pressed")).toBe("false");
    expect(button("HIPAA").getAttribute("aria-pressed")).toBe("true");
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
