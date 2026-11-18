import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmLinkForm, ForgotPasswordForm, SignupForm, UpdatePasswordForm } from "../components/AccountForms";
import { AssessmentWizard } from "../components/AssessmentWizard";
import { CHOICE_FIELDS, CHOICE_QUESTIONS, EMPTY_INPUT, QUESTION_COUNT, QUESTION_LABELS } from "../lib/assessment";
import { DRAFT_KEY, IDLE_TIMEOUT_MS, saveDraft } from "../lib/session";
import { SIMULATIONS_ENDPOINT } from "../lib/simulation";
import { assessmentResult, hangingFetch, stubAssessmentApi } from "./assessment-fixture";
import { expectNoViolations } from "./axe";

/**
 * Accessibility checks for the assessment flow (SCRUM-17).
 *
 * axe-core catches the machine-checkable WCAG failures. Colour contrast
 * cannot be judged in jsdom, so it is excluded here.
 */

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
  choosePurpose();
}

function choosePurpose(purpose = "overlap") {
  fireEvent.change(screen.getByLabelText(QUESTION_LABELS.purpose, { exact: false }), { target: { value: purpose } });
}

async function reachResults() {
  answerQuestions();
  fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
  await screen.findByText(/what drives this score/i);
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
    saveDraft({ input: draft });
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

  it("blocks personal details in the description and offers to replace them", async () => {
    const { container } = render(<AssessmentWizard />);
    describeUseCase("Compare Maria Garcia's records (maria@example.com, DOB 04/12/1979) with our partner.");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/a person's name, an email address and a date of birth/i);
    expect(alert.textContent).not.toContain("maria@example.com");
    expect(screen.getByRole("heading", { name: /what are you proposing/i })).toBeTruthy();
    await waitFor(() => expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain("[email]"));
    expect(window.sessionStorage.getItem(DRAFT_KEY)).not.toContain("maria@example.com");
    await expectNoViolations(container);

    fireEvent.click(screen.getByRole("button", { name: /replace them with placeholders/i }));
    const field = screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement;
    expect(field.value).toBe("Compare [name]'s records ([email], DOB [date of birth]) with our partner.");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("heading", { name: /how will the data be handled/i })).toBeTruthy();
  });

  it("offers a skip link to the assessment", () => {
    render(<AssessmentWizard />);
    const skip = screen.getByRole("link", { name: /skip to the assessment/i });
    expect(skip.getAttribute("href")).toBe("#assessment");
    expect(document.querySelector("#assessment")).not.toBeNull();
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
    await expectNoViolations(container);
  });

  it("shows recommendations as the app's own advice and links regulatory sources", async () => {
    render(<AssessmentWizard />);
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));
    await screen.findByText(/controls before approval/i);

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

describe("account pages", () => {
  it("have no accessibility violations", async () => {
    for (const page of [
      <SignupForm key="signup" />,
      <ForgotPasswordForm key="forgot" expired />,
      <ConfirmLinkForm key="confirm" tokenHash="abc" type="email" />,
      <UpdatePasswordForm key="update" />,
    ]) {
      const { container, unmount } = render(page);
      await expectNoViolations(container);
      unmount();
    }
  });
});

describe("demo UX traps (SCRUM-28)", () => {
  it("leaves purpose unselected and requires it before scoring", async () => {
    render(<AssessmentWizard />);
    describeUseCase();
    await screen.findByText(/how will the data be handled/i);
    const select = screen.getByLabelText(QUESTION_LABELS.purpose, { exact: false }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText("Questions answered").closest(".stat-card")?.textContent).toContain(`0/ ${QUESTION_COUNT}`);

    completeQuestions();
    choosePurpose("");
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/choose the intended use/i);
    expect(fetch).not.toHaveBeenCalled();

    choosePurpose("analytics");
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).purpose).toBe("analytics");
  });

  it("asks before start over clears the assessment, and can be cancelled", async () => {
    const { container } = render(<AssessmentWizard />);
    await reachResults();
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));
    await screen.findByText(/controls before approval/i);

    const startOver = screen.getByRole("button", { name: "Start over" });
    fireEvent.click(startOver);
    expect(startOver.getAttribute("aria-expanded")).toBe("true");
    const prompt = screen.getByRole("group", { name: "Start over?" });
    expect(document.activeElement).toBe(within(prompt).getByRole("button", { name: /keep my assessment/i }));
    await expectNoViolations(container);

    fireEvent.click(within(prompt).getByRole("button", { name: /keep my assessment/i }));
    expect(screen.queryByRole("group", { name: "Start over?" })).toBeNull();
    expect(screen.getByText(/controls before approval/i)).toBeTruthy();
    expect(document.activeElement).toBe(startOver);

    fireEvent.click(startOver);
    fireEvent.keyDown(screen.getByRole("group", { name: "Start over?" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Start over?" })).toBeNull();

    fireEvent.click(startOver);
    fireEvent.click(screen.getByRole("button", { name: /yes, start over/i }));
    expect(screen.getByRole("status").textContent).toContain("Step 1 of 4");
    expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe("");
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("scales factor bars against the heaviest rule the API reports, not the 100-point cap", async () => {
    const { container } = render(<AssessmentWizard />);
    await reachResults();
    const widths = Array.from(container.querySelectorAll<HTMLElement>(".factor-bar i")).map((bar) => parseFloat(bar.style.width));
    const expected = assessmentResult.factors.map((factor) => (factor.points / assessmentResult.maxFactorPoints!) * 100);
    expect(widths).toHaveLength(expected.length);
    widths.forEach((width, index) => expect(width).toBeCloseTo(expected[index]));
    expect(Math.max(...widths)).toBe(100);
  });

  it.each([
    ["assessment", /what drives this score/i, false],
    ["recommendations", /controls before approval/i, true],
  ])("keeps the %s screen after a refresh", async (_name, heading, toRecommendations) => {
    const first = render(<AssessmentWizard />);
    // Let the mount-time draft restore finish, as it would before anyone could type.
    await act(() => new Promise((done) => setTimeout(done, 0)));
    await reachResults();
    if (toRecommendations) {
      fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));
      await screen.findByText(/controls before approval/i);
    }
    // A refresh fires pagehide, which flushes the debounced draft save.
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    first.unmount();

    const { container } = render(<AssessmentWizard />);
    await screen.findByText(heading);
    const stepStatus = screen.getAllByRole("status").find((item) => item.textContent?.startsWith("Step "));
    expect(stepStatus?.textContent).not.toContain("Step 1 of 4");
    // The restored result isn't scored again; only the what-if simulator asks for its outcomes.
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url !== SIMULATIONS_ENDPOINT)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /answer questions/i }).hasAttribute("disabled")).toBe(false);
    await expectNoViolations(container);
  });

  it.each([
    ["the saved version link", { assessmentId: "7d1c3b1e-6a8f-4c2d-9b1a-2f5e8c9d0a11", version: 3 }, /saved to my assessments as version 3/i],
    ["the retry prompt for a failed save", null, /couldn’t be saved/i],
  ])("keeps %s after a refresh", async (_name, saved, message) => {
    stubAssessmentApi(new Response(JSON.stringify({ ...assessmentResult, saved })));
    const first = render(<AssessmentWizard />);
    await act(() => new Promise((done) => setTimeout(done, 0)));
    await reachResults();
    expect(document.body.textContent).toMatch(message);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    first.unmount();

    render(<AssessmentWizard />);
    await screen.findByText(/what drives this score/i);
    expect(document.body.textContent).toMatch(message);
  });
});
