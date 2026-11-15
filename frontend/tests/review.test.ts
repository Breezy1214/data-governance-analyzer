import { expect, it } from "vitest";
import { reviewActions, type ReviewEvent, type ReviewRole } from "../lib/review";
import { buildReportModel } from "../lib/report";
import { assessmentResult, completeInput } from "./assessment-fixture";

it("never offers self-review and permits decisions only to reviewers/admins in review", () => {
  for (const role of [null, "submitter", "reviewer", "admin"] as (ReviewRole | null)[]) {
    expect(reviewActions("in_review", true, role)).toEqual([]);
    expect(reviewActions("approved", false, role)).toEqual([]);
  }
  expect(reviewActions("in_review", false, "submitter")).toEqual([]);
  expect(reviewActions("in_review", false, "reviewer")).toContain("approved");
  expect(reviewActions("draft", true, "submitter")).toEqual(["in_review"]);
});
it("prints the persisted sign-off and omits it for unapproved or mismatched records", () => {
  const event: ReviewEvent = { id: 1, version_id: "v1", assessment_id: "a1", version: 3, actor_id: "r1",
    actor_label: "Reviewer", occurred_at: "2026-11-14T12:00:00Z", from_status: "in_review", to_status: "approved",
    comment: "Controls checked", rules_version: "2.0", mapping_version: "2.0" };
  const model = buildReportModel(completeInput, assessmentResult, event);
  expect(JSON.stringify(model)).toContain("Reviewer");
  expect(JSON.stringify(model)).toContain("2026-11-14T12:00:00Z");
  for (const invalid of [undefined, { ...event, to_status: "rejected" }, { ...event, mapping_version: "old" }]) {
    expect(buildReportModel(completeInput, assessmentResult, invalid).sections.some((s) => s.heading === "Review sign-off")).toBe(false);
  }
});
