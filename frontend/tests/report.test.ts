import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentInput } from "../lib/assessment";
import { DISCLAIMER, ReportModel, buildReportModel, downloadAssessmentReport, formatCheckedOn, renderAssessmentPdf } from "../lib/report";
import { assessmentResult, completeInput as input } from "./assessment-fixture";

const result = assessmentResult;
const model = buildReportModel(input, result);

function headingsOf(report: ReportModel): string[] {
  return report.sections.map((section) => section.heading);
}

const headings = headingsOf(model);
const flat = JSON.stringify(model);

afterEach(() => vi.restoreAllMocks());

describe("report model", () => {
  it("includes every section the ticket requires", () => {
    expect(headings).toEqual([
      "Use case",
      "Questionnaire responses",
      "Risk assessment",
      "Contributing risk factors",
      "Recommended actions",
      "Specialist review required",
      "Disclaimer",
    ]);
  });

  it("never prints personal values in the use case, even if one reached the input", () => {
    const leaked = buildReportModel({ ...input, description: "Share jane@example.com's history with the partner." }, result);
    const useCase = leaked.sections.find((section) => section.heading === "Use case");
    expect(useCase).toEqual({ heading: "Use case", kind: "paragraph", body: "Share [email]'s history with the partner." });
  });

  it("reports the same score, level, and rules version shown in the app", () => {
    expect(flat).toContain(`${result.score} out of 100`);
    expect(flat).toContain(result.level);
    expect(flat).toContain(result.guidance);
    expect(model.meta).toContainEqual({ label: "Scoring rules version", value: result.rulesVersion });
    expect(model.meta).toContainEqual({ label: "Recommendation catalog version", value: result.mappingVersion });
    expect(model.meta).toContainEqual({ label: "Catalog approval", value: "Approved" });
    expect(model.meta).toContainEqual({ label: "Sources checked", value: "November 4, 2026" });
  });

  it("carries the use case, every answer, and every recommendation", () => {
    expect(flat).toContain(input.description);
    expect(flat).toContain("Email addresses, Health information");
    expect(flat).toContain("Patient or clinical research");
    expect(flat).toContain("Hashed or tokenized");
    expect(flat).toContain("HIPAA");
    result.recommendations.forEach((item) => {
      expect(flat).toContain(item.action);
      expect(flat).toContain(item.rationale);
      item.basedOn.forEach((label) => expect(flat).toContain(label));
    });
    result.factors.forEach((factor) => expect(flat).toContain(factor.label));
  });

  it("links regulatory references to their sources", () => {
    const actions = model.sections.find((section) => section.heading === "Recommended actions");
    const [first] = actions && actions.kind === "list" ? actions.items : [];
    const [reference] = result.recommendations[0].references;
    expect(first).toContain(`Regulatory reference: ${reference.statement} Source: ${reference.sourceTitle}, ${reference.sourceUrl}`);
  });

  it("marks a recommendation that applies to every assessment", () => {
    expect(flat).toContain("Applies to every assessment.");
  });

  it("formats the source check date without shifting the day", () => {
    expect(formatCheckedOn("2026-11-04")).toBe("November 4, 2026");
    expect(formatCheckedOn("not a date")).toBe("not a date");
  });

  it("omits internal rule identifiers and categories", () => {
    result.factors.forEach((factor) => {
      expect(flat).not.toContain(factor.ruleId);
      expect(flat).not.toContain(`"${factor.category}"`);
    });
    expect(flat).not.toContain("schemaVersion");
  });

  it("states the decision-support disclaimer", () => {
    expect(flat).toContain(DISCLAIMER);
  });

  it("drops the conditional sections when they do not apply", () => {
    const lowModel = buildReportModel(input, { ...result, limitations: [] });
    expect(headingsOf(lowModel)).not.toContain("Specialist review required");
  });

  it("labels an unanswered question instead of leaving it blank", () => {
    const partial = buildReportModel({ ...input, combined: "", regulations: [] }, result);
    expect(JSON.stringify(partial)).toContain("Not answered");
  });
});

describe("pdf rendering", () => {
  it("does not download a report cancelled during generation", async () => {
    const pdfModule = await import("jspdf");
    const doc = new pdfModule.jsPDF();
    const save = vi.spyOn(doc, "save").mockReturnThis();
    vi.spyOn(pdfModule, "jsPDF").mockImplementation(function () { return doc; });
    const controller = new AbortController();
    const download = downloadAssessmentReport(input, result, controller.signal);
    controller.abort();
    await download;
    expect(save).not.toHaveBeenCalled();
  });

  it("produces a multi-page PDF that fits long content", async () => {
    const wordy: AssessmentInput = { ...input, description: "Merge partner records. ".repeat(60) };
    const doc = await renderAssessmentPdf(buildReportModel(wordy, result));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const bytes = doc.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 8))).toContain("%PDF-");
  });

  it("embeds the report title and no personal metadata", async () => {
    const doc = await renderAssessmentPdf(model);
    const raw = doc.output("datauristring");
    const pdf = Buffer.from(raw.split(",")[1], "base64").toString("latin1");
    expect(pdf).toContain("Data Governance Readiness Assessment");
    expect(pdf).not.toContain("/Author");
    expect(pdf).not.toContain("/Keywords");
  });
});
