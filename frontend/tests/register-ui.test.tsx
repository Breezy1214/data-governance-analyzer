import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentResult, completeInput, stubAssessmentApi } from "./assessment-fixture";
import { expectNoViolations } from "./axe";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const pages = vi.hoisted(() => ({ loadRegister: vi.fn(), loadAssessmentPage: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/register-page", () => pages);
vi.mock("../lib/review-server", () => ({
  reviewContext: vi.fn(async () => ({ ownerId: "user", workspaceId: null, role: null, events: [] })),
  reviewWorkspaces: vi.fn(async () => []),
}));

import { AssessmentWizard } from "../components/AssessmentWizard";
import { AuthenticatedAssessment } from "../components/AuthenticatedAssessment";
import { DemoAssessment } from "../components/DemoAssessment";
import { SavedAssessmentActions } from "../components/SavedAssessmentActions";
import MyAssessments from "../app/assessments/page";
import LoadingAssessments from "../app/assessments/loading";
import SavedAssessment from "../app/assessments/[id]/page";
import { toScoringPayload } from "../lib/assessment";
import { DEMO_SCENARIOS } from "../lib/demo-scenarios";
import { DRAFT_KEY } from "../lib/session";
import {
  DESCRIPTION_NOT_SAVED, type SavedAssessmentVersion, answersToInput, assessmentTitle, toRegisterEntry,
} from "../lib/register";

const ID = "6f1c2a5e-3b4d-4c8e-9a7f-0123456789ab";
const session = { user: { id: "user", email: "client@example.test" } };
const answers = toScoringPayload(completeInput);

function version(number: number, status: SavedAssessmentVersion["status"] = "draft"): SavedAssessmentVersion {
  return {
    id: `version-${number}`, assessmentId: ID, version: number, status,
    input: { ...completeInput, description: "" }, result: assessmentResult, savedAt: `2026-11-1${number}T15:00:00Z`,
  };
}

function savedResponse(saved: unknown) {
  return Response.json({ ...assessmentResult, saved });
}

async function assessFromQuestions() {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
  await screen.findByRole("heading", { level: 2, name: /high risk/i });
}

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("register helpers", () => {
  it("names a saved assessment from its answers, since the description isn't saved", () => {
    expect(assessmentTitle(completeInput)).toBe("Patient or clinical research · Email addresses, Health information");
    expect(assessmentTitle({ purpose: "overlap", dataTypes: ["names", "emails", "phone", "gov"] }))
      .toBe("Overlap analysis · Names, Email addresses +2 more");
  });

  it("restores saved answers without a description and rejects anything else", () => {
    expect(answersToInput({ schemaVersion: "3.0", ...answers })).toEqual({ ...completeInput, description: "" });
    expect(answersToInput({ ...answers, purpose: "unknown" })).toBeNull();
    expect(answersToInput(null)).toBeNull();
  });

  it("skips register rows it can't read instead of showing partial data", () => {
    const entry = {
      assessmentId: ID, version: 2, versionCount: 2, status: "draft", score: 86, level: "HIGH",
      answers, savedAt: "2026-11-12T15:00:00Z",
    };
    expect(toRegisterEntry(entry)).toMatchObject({ assessmentId: ID, version: 2, level: "HIGH", status: "draft" });
    expect(toRegisterEntry({ ...entry, status: "archived" })).toBeNull();
    expect(toRegisterEntry({ ...entry, level: "SEVERE" })).toBeNull();
  });
});

describe("saving from the wizard", () => {
  it("saves a completed assessment and saves re-assessments as new versions", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(savedResponse({ assessmentId: ID, version: 1 }))
      .mockResolvedValueOnce(savedResponse({ assessmentId: ID, version: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthenticatedAssessment session={session} reopened={{ input: completeInput, saveTo: null, notice: "" }} />);

    await assessFromQuestions();
    const status = screen.getByText(/saved to/i);
    expect(status.textContent).toBe("Saved to My assessments as version 1.");
    expect(within(status).getByRole("link").getAttribute("href")).toBe(`/assessments/${ID}?version=1`);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assessments");

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByText(/as version 2/);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/assessments/${ID}/versions`);
  });

  it("keeps the result and offers a retry when saving fails", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(savedResponse(null))
      .mockResolvedValueOnce(savedResponse({ assessmentId: ID, version: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentWizard initialInput={completeInput} keepDrafts={false} />);

    await assessFromQuestions();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn’t be saved/);
    expect(screen.getByText(String(assessmentResult.score), { selector: ".score-number" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try saving again/i }));
    await screen.findByText(/as version 1/);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/assessments");
  });

  it("never shows saving in demo mode", async () => {
    stubAssessmentApi();
    render(<DemoAssessment />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(DEMO_SCENARIOS[0].title) }));
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByRole("heading", { level: 2, name: /high risk/i });

    expect(screen.queryByText(/saved to/i)).toBeNull();
    expect(screen.queryByText(/couldn’t be saved/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /my assessments/i })).toBeNull();
  });

  it("re-assesses a saved assessment into its next version, starting from its answers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(savedResponse({ assessmentId: ID, version: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthenticatedAssessment session={session}
      reopened={{ input: { ...completeInput, description: "" }, saveTo: ID, notice: "Re-assessing from version 2." }} />);

    expect(screen.getByText("Re-assessing from version 2.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/use-case description/i), { target: { value: completeInput.description } });
    await assessFromQuestions();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/assessments/${ID}/versions`);
    expect(screen.getByText(/as version 3/)).toBeTruthy();
    // A reopened assessment never replaces the draft kept in this tab.
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("My assessments", () => {
  it("lists each assessment's latest version with risk level, status and date", async () => {
    pages.loadRegister.mockResolvedValue({ session, entries: [{
      assessmentId: ID, version: 2, versionCount: 2, status: "in_review", score: 86, level: "HIGH",
      title: "Patient or clinical research · Email addresses, Health information",
      savedAt: "2026-11-12T15:00:00Z",
    }] });
    const { container } = render(await MyAssessments());

    const row = screen.getByRole("row", { name: /patient or clinical research/i });
    expect(within(row).getByRole("link").getAttribute("href")).toBe(`/assessments/${ID}`);
    expect(row.textContent).toContain("Version 2 of 2");
    expect(row.textContent).toContain("High · 86");
    expect(row.textContent).toContain("In review");
    expect(within(row).getByText(/Nov 12, 2026/).getAttribute("datetime")).toBe("2026-11-12T15:00:00Z");
    // A version in review locks the assessment, so its row offers no Delete.
    expect(within(row).queryByRole("button", { name: /delete/i })).toBeNull();
    await expectNoViolations(container);
  });

  describe("deleting from the list", () => {
    const title = "Overlap analysis · Names";

    beforeAll(() => {
      // jsdom has no modal dialogs yet.
      Object.assign(HTMLDialogElement.prototype, {
        showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); },
        close(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); },
      });
    });

    beforeEach(() => {
      pages.loadRegister.mockResolvedValue({ session, entries: [{
        assessmentId: ID, version: 3, versionCount: 3, status: "draft", score: 70, level: "HIGH", title,
        savedAt: "2026-11-12T15:00:00Z",
      }] });
    });

    async function confirmDelete() {
      const { container } = render(await MyAssessments());
      fireEvent.click(screen.getByRole("button", { name: `Delete ${title}` }));
      const dialog = screen.getByRole("dialog", { name: "Delete this assessment?" });
      expect(dialog.textContent).toContain(title);
      expect(dialog.textContent).toMatch(/permanently deletes all 3 versions/i);
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep it" }));
      await expectNoViolations(container);
      fireEvent.click(within(dialog).getByRole("button", { name: /delete permanently/i }));
      return dialog;
    }

    it("deletes a row after confirmation without opening the assessment", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);
      const dialog = await confirmDelete();

      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/assessments/${ID}`);
      expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
      expect(dialog.hasAttribute("open")).toBe(false);
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("keeps the prompt open with the reason when the delete is refused", async () => {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ message: "This assessment has a version in review or approved, so it can't be deleted." }, { status: 409 })));
      const dialog = await confirmDelete();

      expect((await within(dialog).findByRole("alert")).textContent).toMatch(/in review or approved/);
      expect(dialog.hasAttribute("open")).toBe(true);
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep it" }));
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });
  it("shows a busy skeleton while the register loads", async () => {
    const { container } = render(<LoadingAssessments />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Loading…");
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    await expectNoViolations(container);
  });
});

describe("a saved assessment", () => {
  const props = { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) };

  it("shows the saved result, its versions and what was not saved", async () => {
    const versions = [version(1), version(2)];
    pages.loadAssessmentPage.mockResolvedValue({ session, versions, selected: versions[0], latest: versions[1], isOwner: true });
    const { container } = render(await SavedAssessment(props));

    expect(screen.getByRole("heading", { level: 2, name: /high risk/i })).toBeTruthy();
    expect(screen.getByText(assessmentResult.recommendations[0].title)).toBeTruthy();
    expect(screen.getByText(DESCRIPTION_NOT_SAVED)).toBeTruthy();
    expect(screen.getByText(/this is an earlier version/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Version 1" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /re-assess/i }).getAttribute("href")).toBe(`/assessments/${ID}/reassess?version=1`);
    expect(screen.getByRole("link", { name: /duplicate/i }).getAttribute("href")).toBe(`/assessments/${ID}/duplicate?version=1`);
    expect(container.textContent).not.toContain(completeInput.description);
    await expectNoViolations(container);
  });

  it("lets a workspace reviewer read and download a colleague's version but not change it", async () => {
    const submitted = [version(1, "in_review")];
    pages.loadAssessmentPage.mockResolvedValue({ session, versions: submitted, selected: submitted[0], latest: submitted[0], isOwner: false });
    render(await SavedAssessment(props));
    expect(screen.getByRole("button", { name: /download report/i })).toBeTruthy();
    for (const name of [/re-assess/i, /duplicate/i, /^delete$/i]) expect(screen.queryByRole("link", { name }) ?? screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText(/can’t be deleted/)).toBeNull();
  });

  it("deletes after confirmation and returns to the register", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={2} deletable isOwner />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/permanently deletes all 2 versions/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/assessments"));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/assessments/${ID}`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("returns focus to Delete when the prompt is cancelled or dismissed with Escape", () => {
    render(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={1} deletable isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("group", { name: "Delete this assessment?" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Delete this assessment?" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
  });

  it("explains when a reviewed assessment can't be deleted", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ message: "A version is in review or approved, so it can't be deleted." }, { status: 409 })));
    const { rerender } = render(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={1} deletable isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/in review or approved/);
    expect(router.replace).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));

    rerender(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={1} deletable={false} isOwner />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(/can’t be deleted/)).toBeTruthy();
  });
});
