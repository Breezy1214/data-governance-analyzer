import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentResult, completeInput, stubAssessmentApi } from "./assessment-fixture";
import { expectNoViolations } from "./axe";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const pages = vi.hoisted(() => ({ signedIn: vi.fn(), loadAssessmentPage: vi.fn(), listRegister: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/register-page", () => ({ signedIn: pages.signedIn, loadAssessmentPage: pages.loadAssessmentPage }));
vi.mock("../lib/register-server", () => ({ listRegister: pages.listRegister }));

import { AssessmentWizard } from "../components/AssessmentWizard";
import { AuthenticatedAssessment } from "../components/AuthenticatedAssessment";
import { DemoAssessment } from "../components/DemoAssessment";
import { SavedAssessmentActions } from "../components/SavedAssessmentActions";
import MyAssessments from "../app/assessments/page";
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
    const row = {
      assessment_id: ID, version: 2, version_count: 2, status: "draft", score: 86, risk_level: "HIGH",
      answers, saved_at: "2026-11-12T15:00:00Z",
    };
    expect(toRegisterEntry(row)).toMatchObject({ assessmentId: ID, version: 2, level: "HIGH", status: "draft" });
    expect(toRegisterEntry({ ...row, status: "archived" })).toBeNull();
    expect(toRegisterEntry({ ...row, risk_level: "SEVERE" })).toBeNull();
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
    const fetchMock = stubAssessmentApi();
    render(<DemoAssessment />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(DEMO_SCENARIOS[0].title) }));
    fireEvent.click(screen.getByRole("button", { name: /assess risk/i }));
    await screen.findByRole("heading", { level: 2, name: /high risk/i });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/demo/assessments");
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
    pages.signedIn.mockResolvedValue({ client: {}, session });
    pages.listRegister.mockResolvedValue([{
      assessmentId: ID, version: 2, versionCount: 2, status: "in_review", score: 86, level: "HIGH",
      title: "Patient or clinical research · Email addresses, Health information",
      savedAt: "2026-11-12T15:00:00Z",
    }]);
    const { container } = render(await MyAssessments());

    const row = screen.getByRole("row", { name: /patient or clinical research/i });
    expect(within(row).getByRole("link").getAttribute("href")).toBe(`/assessments/${ID}`);
    expect(row.textContent).toContain("Version 2 of 2");
    expect(row.textContent).toContain("High · 86");
    expect(row.textContent).toContain("In review");
    expect(within(row).getByText(/Nov 12, 2026/).getAttribute("datetime")).toBe("2026-11-12T15:00:00Z");
    await expectNoViolations(container);
  });
});

describe("a saved assessment", () => {
  const props = { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) };

  it("shows the saved result, its versions and what was not saved", async () => {
    const versions = [version(1), version(2)];
    pages.loadAssessmentPage.mockResolvedValue({ session, versions, selected: versions[0], latest: versions[1] });
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

  it("deletes after confirmation and returns to the register", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={2} deletable />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/permanently deletes all 2 versions/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/assessments"));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/assessments/${ID}`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("explains when a reviewed assessment can't be deleted", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ message: "A version is in review or approved, so it can't be deleted." }, { status: 409 })));
    const { rerender } = render(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={1} deletable />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/in review or approved/);
    expect(router.replace).not.toHaveBeenCalled();

    rerender(<SavedAssessmentActions assessmentId={ID} input={completeInput} result={assessmentResult}
      reassessHref="/r" duplicateHref="/d" versionCount={1} deletable={false} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(/can’t be deleted/)).toBeTruthy();
  });
});
