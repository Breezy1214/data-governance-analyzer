import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentInput } from "../lib/assessment";
import { DISCLAIMER, ReportModel, buildReportModel, downloadAssessmentReport, renderAssessmentPdf } from "../lib/report";
import { assessmentResult } from "./assessment-fixture";

const input: AssessmentInput = {
  description: "Share loyalty member emails and health survey answers with a research partner.",
  dataTypes: ["emails", "health"],
  externalAccess: "yes",
  rawExchange: "yes",
  dataMovement: "yes",
  combined: "yes",
  secondaryUse: "yes",
  purpose: "research",
};

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
      "Recommended safeguards",
      "Karlsgate capability fit",
      "Specialist review required",
      "Disclaimer",
    ]);
  });

  it("reports the same score, level, and rules version shown in the app", () => {
    expect(flat).toContain(`${result.score} out of 100`);
    expect(flat).toContain(result.level);
    expect(flat).toContain(result.guidance);
    expect(model.meta).toContainEqual({ label: "Scoring rules version", value: result.rulesVersion });
    expect(model.meta).toContainEqual({ label: "Recommendation mapping version", value: result.mappingVersion });
    expect(model.meta).toContainEqual({ label: "Mapping approval", value: "Approved" });
  });

  it("carries the use case, every answer, and every recommendation", () => {
    expect(flat).toContain(input.description);
    expect(flat).toContain("Email addresses, Health information");
    expect(flat).toContain("Research");
    result.recommendationDetails.forEach((item) => {
      expect(flat).toContain(item.action);
      expect(flat).toContain(item.rationale);
      item.riskFactorIds.forEach((ruleId) => {
        expect(flat).toContain(result.factors.find((factor) => factor.ruleId === ruleId)?.label);
      });
    });
    result.factors.forEach((factor) => expect(flat).toContain(factor.label));
    result.karlsgateRecommendations.forEach((item) => expect(flat).toContain(item.text));
    expect(flat).toContain("Relevant to:");
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
    const partial = buildReportModel({ ...input, combined: "" }, result);
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
