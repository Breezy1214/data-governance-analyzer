import { expect, it } from "vitest";
import { approvalSignOff, reviewActions, type ReviewEvent, type ReviewRole } from "../lib/review";
import { buildReportModel } from "../lib/report";
import { assessmentResult, completeInput } from "./assessment-fixture";

const approval: ReviewEvent = {
  id: 2, version_id: "v1", assessment_id: "a1", version: 3, actor_id: "r1", actor_label: "r1", actor_name: "reviewer@example.test",
  occurred_at: "2026-11-14T12:00:00Z", from_status: "in_review", to_status: "approved", comment: "Controls checked",
  rules_version: "2.0", mapping_version: "2.0",
};
const signOff = (event?: ReviewEvent) =>
  buildReportModel(completeInput, assessmentResult, null, event).sections.find((section) => section.heading === "Review sign-off");

it("never offers self-review and permits decisions only to reviewers and admins", () => {
  for (const role of [null, "submitter", "reviewer", "admin"] as (ReviewRole | null)[]) {
    expect(reviewActions("in_review", true, role, "w")).toEqual([]);
    expect(reviewActions("approved", false, role, "w")).toEqual([]);
  }
  expect(reviewActions("in_review", false, "submitter", "w")).toEqual([]);
  expect(reviewActions("in_review", false, "reviewer", "w")).toEqual(["approved", "changes_requested", "rejected"]);
  expect(reviewActions("draft", true, "submitter", null)).toEqual(["in_review"]);
  expect(reviewActions("in_review", true, null, null)).toEqual(["in_review"]);
});

it("signs off only approved versions, with the reviewer named and the date formatted", () => {
  expect(approvalSignOff("in_review", [approval])).toBeUndefined();
  expect(approvalSignOff("approved", [approval, { ...approval, id: 3, to_status: "draft" }])).toBe(approval);
  expect(signOff()).toBeUndefined();
  const text = JSON.stringify(signOff(approval));
  expect(text).toContain("reviewer@example.test");
  expect(text).toContain("Reviewer account ID");
  expect(text).not.toContain("2026-11-14T12:00:00Z");
});

it("says when an approval predates sign-off records", () => {
  const text = JSON.stringify(signOff({ ...approval, actor_id: null, actor_label: "Migration", actor_name: "Migration" }));
  expect(text).toContain("before sign-off records were kept");
  expect(text).not.toContain("Migration");
});
