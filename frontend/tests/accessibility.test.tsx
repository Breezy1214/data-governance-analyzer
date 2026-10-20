import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentWizard } from "../components/AssessmentWizard";
import { CAPABILITY_COPY, EMPTY_INPUT, QUESTION_LABELS } from "../lib/assessment";
import { DRAFT_KEY, IDLE_TIMEOUT_MS, saveDraft } from "../lib/session";
import { assessmentResult } from "./assessment-fixture";

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

function completeQuestions() {
  ["externalAccess", "rawExchange", "dataMovement", "combined", "secondaryUse"].forEach((key) => {
    const group = screen.getByRole("group", {
      name: new RegExp(QUESTION_LABELS[key as keyof typeof QUESTION_LABELS].slice(0, 24), "i"),
    });
    fireEvent.click(within(group).getByRole("button", { name: "Yes" }));
  });
}

function answerQuestions() {
  fireEvent.change(screen.getByLabelText(/use-case description/i), {
    target: { value: "Share loyalty member emails with a partner brand for campaign measurement." },
  });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  fireEvent.click(screen.getByRole("button", { name: /email addresses/i }));
  completeQuestions();
}

beforeEach(() => {
  window.sessionStorage.clear?.();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      new Response(JSON.stringify(assessmentResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
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
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    render(<AssessmentWizard />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    answerQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS));
    expect(screen.getByText(/session expired/i)).toBeTruthy();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect((screen.getByLabelText(/use-case description/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("aborts scoring when the wizard unmounts", async () => {
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
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

  it("announces the current step through a status region", () => {
    render(<AssessmentWizard />);
    expect(screen.getByRole("status").textContent).toContain("Step 1 of 4");
  });

  it("keeps every step reachable and accessible through the whole flow", async () => {
    const { container } = render(<AssessmentWizard />);

    fireEvent.change(screen.getByLabelText(/use-case description/i), {
      target: { value: "Share loyalty member emails with a partner brand for campaign measurement." },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // Step 2: questions
    await screen.findByText(/how will the data be handled/i);
    await expectNoViolations(container);
    fireEvent.click(screen.getByRole("button", { name: /email addresses/i }));
    completeQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));

    // Step 3: score
    await screen.findByText(/what drives this score/i);
    await expectNoViolations(container);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));

    // Step 4: recommendations
    await screen.findByText(/controls before approval/i);
    await expectNoViolations(container);
  });

  it("explains each recommended control in approved plain language", async () => {
    const { container } = render(<AssessmentWizard />);
    fireEvent.change(screen.getByLabelText(/use-case description/i), {
      target: { value: "Share loyalty member emails with a partner brand for campaign measurement." },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/how will the data be handled/i);
    fireEvent.click(screen.getByRole("button", { name: /email addresses/i }));
    completeQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/what drives this score/i);
    fireEvent.click(screen.getByRole("button", { name: /see recommendations/i }));

    await waitFor(() => expect(container.querySelector(".capability-list")).not.toBeNull());
    const panel = container.querySelector(".capability-list") as HTMLElement;
    const labels = Array.from(panel.querySelectorAll("b")).map((node) => node.textContent ?? "");
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((label) => {
      expect(CAPABILITY_COPY[label]).toBeTruthy();
      expect(panel.textContent).toContain(CAPABILITY_COPY[label]);
    });

    expect(screen.getByText(/HIGH RISK · 100\/100/i)).toBeTruthy();
    assessmentResult.recommendationDetails.forEach((recommendation) => {
      expect(screen.getByText(recommendation.title)).toBeTruthy();
      expect(screen.getByText(recommendation.rationale, { exact: false })).toBeTruthy();
    });
    expect(screen.getAllByText(/Triggered by:/i)).toHaveLength(assessmentResult.recommendationDetails.length);
  });

  it("does not rely on colour alone to convey the risk level", async () => {
    render(<AssessmentWizard />);
    fireEvent.change(screen.getByLabelText(/use-case description/i), {
      target: { value: "Share patient records with an external analytics vendor for modelling." },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/how will the data be handled/i);
    fireEvent.click(screen.getByRole("button", { name: /health information/i }));
    completeQuestions();
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));

    await screen.findByText(/what drives this score/i);
    expect(screen.getByText(/HIGH RISK/)).toBeTruthy();
  });
});
