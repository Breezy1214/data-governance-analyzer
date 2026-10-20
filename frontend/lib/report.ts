import {
  AssessmentInput,
  AssessmentResult,
  CAPABILITY_COPY,
  DATA_TYPE_LABELS,
  PURPOSE_LABELS,
  QUESTION_LABELS,
} from "./assessment";

/**
 * Assessment report (SCRUM-15).
 *
 * The report is built and rendered entirely in the browser and is never
 * uploaded; see docs/data-handling.md. `buildReportModel` is a pure
 * function so the report's content can be tested without a PDF engine,
 * and it deliberately omits internal identifiers such as rule ids.
 */

export const DISCLAIMER =
  "This report is decision support, not legal advice. It does not determine compliance with HIPAA, PCI DSS, or any other regulation. Specialist legal, privacy, and security review may still be required.";

export type ReportSection =
  | { heading: string; kind: "paragraph"; body: string }
  | { heading: string; kind: "pairs"; pairs: { label: string; value: string }[] }
  | { heading: string; kind: "list"; items: string[]; ordered?: boolean };

export type ReportModel = {
  title: string;
  meta: { label: string; value: string }[];
  sections: ReportSection[];
};

function formatAssessedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function buildReportModel(
  input: AssessmentInput,
  result: AssessmentResult,
): ReportModel {
  const factorLabels = new Map(result.factors.map((factor) => [factor.ruleId, factor.label]));
  const sections: ReportSection[] = [
    { heading: "Use case", kind: "paragraph", body: input.description.trim() },
    {
      heading: "Questionnaire responses",
      kind: "pairs",
      pairs: [
        {
          label: "Information involved",
          value: input.dataTypes.map((item) => DATA_TYPE_LABELS[item]).join(", ") || "None selected",
        },
        { label: QUESTION_LABELS.externalAccess, value: answerLabel(input.externalAccess) },
        { label: QUESTION_LABELS.rawExchange, value: answerLabel(input.rawExchange) },
        { label: QUESTION_LABELS.dataMovement, value: answerLabel(input.dataMovement) },
        { label: QUESTION_LABELS.combined, value: answerLabel(input.combined) },
        { label: QUESTION_LABELS.secondaryUse, value: answerLabel(input.secondaryUse) },
        { label: QUESTION_LABELS.purpose, value: PURPOSE_LABELS[input.purpose] },
      ],
    },
    {
      heading: "Risk assessment",
      kind: "pairs",
      pairs: [
        { label: "Risk score", value: `${result.score} out of 100` },
        { label: "Risk level", value: result.level },
        { label: "Guidance", value: result.guidance },
      ],
    },
    {
      heading: "Contributing risk factors",
      kind: "list",
      items: result.factors.length
        ? result.factors.map((factor) => `${factor.label} (+${factor.points})`)
        : ["No risk factors applied to this use case."],
    },
    {
      heading: "Recommended safeguards",
      kind: "list",
      ordered: true,
      items: result.recommendationDetails.map((item) => {
        const triggers = item.riskFactorIds.map((ruleId) => factorLabels.get(ruleId)).filter(Boolean);
        return `${item.action} Why this applies: ${item.rationale} Triggered by: ${triggers.join(", ")}.`;
      }),
    },
  ];

  if (result.capabilities.length) {
    sections.push({
      heading: "Privacy-enhancing capability fit",
      kind: "list",
      items: result.capabilities.map((capability) => `${capability}: ${CAPABILITY_COPY[capability] ?? ""}`),
    });
  }

  if (result.limitations.length) {
    sections.push({
      heading: "Specialist review required",
      kind: "list",
      items: result.limitations,
    });
  }

  sections.push({ heading: "Disclaimer", kind: "paragraph", body: DISCLAIMER });

  return {
    title: "Data Governance Readiness Assessment",
    meta: [
      { label: "Assessed", value: formatAssessedAt(result.assessedAt) },
      { label: "Scoring rules version", value: result.rulesVersion },
    ],
    sections,
  };
}

function answerLabel(value: string): string {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  return "Not answered";
}

// --- PDF rendering ------------------------------------------------------

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const LINE_HEIGHT = 14;

type Doc = import("jspdf").jsPDF;

function wrap(doc: Doc, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

/** Renders the model into a jsPDF document, paginating as it goes. */
export async function renderAssessmentPdf(model: ReportModel): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  doc.setLanguage("en-US");
  // Title only: no author, keywords, or other metadata about the person.
  doc.setProperties({ title: model.title });

  let y = MARGIN;

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };

  const space = (needed: number) => {
    if (y + needed > PAGE.height - MARGIN - 24) newPage();
  };

  const writeLines = (lines: string[], indent = 0) => {
    for (const line of lines) {
      space(LINE_HEIGHT);
      doc.text(line, MARGIN + indent, y);
      y += LINE_HEIGHT;
    }
  };

  // Title block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  writeLines(wrap(doc, model.title, CONTENT_WIDTH));
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  writeLines(model.meta.map((item) => `${item.label}: ${item.value}`));
  doc.setTextColor(0);
  y += 6;
  doc.setDrawColor(190);
  doc.line(MARGIN, y, PAGE.width - MARGIN, y);
  y += 16;

  for (const section of model.sections) {
    space(LINE_HEIGHT * 3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    writeLines(wrap(doc, section.heading, CONTENT_WIDTH));
    y += 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    if (section.kind === "paragraph") {
      writeLines(wrap(doc, section.body, CONTENT_WIDTH));
    } else if (section.kind === "pairs") {
      for (const pair of section.pairs) {
        doc.setFont("helvetica", "bold");
        writeLines(wrap(doc, pair.label, CONTENT_WIDTH));
        doc.setFont("helvetica", "normal");
        writeLines(wrap(doc, pair.value, CONTENT_WIDTH - 12), 12);
        y += 2;
      }
    } else {
      section.items.forEach((item, index) => {
        const marker = section.ordered ? `${index + 1}.` : "•";
        const lines = wrap(doc, item, CONTENT_WIDTH - 18);
        space(LINE_HEIGHT * Math.min(lines.length, 3));
        doc.text(marker, MARGIN, y);
        writeLines(lines, 18);
        y += 2;
      });
    }

    y += 12;
  }

  // Footer on every page, added last so the page count is final.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Decision support, not legal advice.", MARGIN, PAGE.height - MARGIN + 16);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - MARGIN, PAGE.height - MARGIN + 16, { align: "right" });
  }

  return doc;
}

export const REPORT_FILENAME = "data-governance-assessment.pdf";

/**
 * Builds and downloads the report. Throws if generation fails so the
 * caller can show a message; the assessment on screen is untouched.
 */
export async function downloadAssessmentReport(
  input: AssessmentInput,
  result: AssessmentResult,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const doc = await renderAssessmentPdf(buildReportModel(input, result));
  if (!signal?.aborted) doc.save(REPORT_FILENAME);
}
