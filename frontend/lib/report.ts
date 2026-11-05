import {
  AssessmentInput,
  AssessmentResult,
  CHOICE_FIELDS,
  CHOICE_QUESTIONS,
  ChoiceField,
  DATA_TYPE_LABELS,
  PURPOSE_LABELS,
  QUESTION_LABELS,
  REGULATION_LABELS,
  Recommendation,
  RiskLevel,
} from "./assessment";
import { PALETTE, RISK_COLORS } from "./theme";

// Built and rendered in the browser, never uploaded (docs/data-handling.md). buildReportModel is pure and omits internal rule ids.

export const DISCLAIMER =
  "This report is decision support, not legal advice. It does not determine compliance with HIPAA, PCI DSS, GDPR, CCPA/CPRA, or any other regulation. Specialist legal, privacy, and security review may still be required.";

// Attribution wording, shared by the app and the report so the two can't drift apart.
export const BASED_ON_LABEL = "Based on your answers:";
export const EVERY_ASSESSMENT_LABEL = "Applies to every assessment.";
export const REFERENCE_HEADING = "Regulatory reference";

export type ReportSection =
  | { heading: string; kind: "paragraph"; body: string }
  | { heading: string; kind: "pairs"; pairs: { label: string; value: string }[] }
  | { heading: string; kind: "list"; items: string[]; ordered?: boolean };

export type ReportModel = {
  title: string;
  meta: { label: string; value: string }[];
  risk: { level: RiskLevel; score: number };
  sections: ReportSection[];
};

export function formatAssessedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Catalog check dates have no time, so they are read as local dates to avoid shifting a day. */
export function formatCheckedOn(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function recommendationText(item: Recommendation): string {
  const basis = item.basedOn.length ? `${BASED_ON_LABEL} ${item.basedOn.join(", ")}.` : EVERY_ASSESSMENT_LABEL;
  const references = item.references.map((entry) =>
    `${REFERENCE_HEADING}: ${entry.statement} Source: ${entry.sourceTitle}, ${entry.sourceUrl}`);
  return [item.action, `Why this applies: ${item.rationale}`, basis, ...references].join(" ");
}

export function buildReportModel(
  input: AssessmentInput,
  result: AssessmentResult,
): ReportModel {
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
        { label: QUESTION_LABELS.purpose, value: PURPOSE_LABELS[input.purpose] },
        ...CHOICE_FIELDS.map((field) => ({ label: CHOICE_QUESTIONS[field].legend, value: answerLabel(field, input) })),
        {
          label: QUESTION_LABELS.regulations,
          value: input.regulations.map((item) => REGULATION_LABELS[item]).join(", ") || "Not answered",
        },
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
      heading: "Recommended actions",
      kind: "list",
      ordered: true,
      items: result.recommendations.map(recommendationText),
    },
  ];

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
      { label: "Recommendation catalog version", value: result.mappingVersion },
      { label: "Catalog approval", value: result.mappingApprovalStatus === "approved" ? "Approved" : "Approval pending" },
      { label: "Sources checked", value: formatCheckedOn(result.sourcesCheckedOn) },
    ],
    risk: { level: result.level, score: result.score },
    sections,
  };
}

function answerLabel(field: ChoiceField, input: AssessmentInput): string {
  const options: Record<string, string> = CHOICE_QUESTIONS[field].options;
  return options[input[field]] ?? "Not answered";
}

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const LINE_HEIGHT = 14;

type Doc = import("jspdf").jsPDF;

function wrap(doc: Doc, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

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

  doc.setTextColor(PALETTE.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  writeLines(wrap(doc, model.title, CONTENT_WIDTH));
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(PALETTE.muted);
  writeLines(model.meta.map((item) => `${item.label}: ${item.value}`));
  y += 6;

  // Risk banner: shape and text label, so the level never depends on colour.
  const riskColor = RISK_COLORS[model.risk.level];
  doc.setFillColor(riskColor);
  drawRiskShape(doc, model.risk.level, MARGIN + 5, y - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(riskColor);
  doc.text(`${model.risk.level} RISK · ${model.risk.score} / 100`, MARGIN + 16, y);
  doc.setTextColor(PALETTE.ink);
  y += 14;
  doc.setDrawColor(PALETTE.line);
  doc.line(MARGIN, y, PAGE.width - MARGIN, y);
  y += 16;

  for (const section of model.sections) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const heading = wrap(doc, section.heading, CONTENT_WIDTH);
    // Keep the heading with the first lines of its content, so a heading never ends a page.
    space(LINE_HEIGHT * (heading.length + Math.min(firstBlockLines(doc, section), 3)) + 2);
    writeLines(heading);
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
    doc.setTextColor(PALETTE.muted);
    doc.text("Decision support, not legal advice.", MARGIN, PAGE.height - MARGIN + 16);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - MARGIN, PAGE.height - MARGIN + 16, { align: "right" });
  }

  return doc;
}

/** Lines in a section's first paragraph, answer, or list item, at body text size. */
function firstBlockLines(doc: Doc, section: ReportSection): number {
  const measure = (text: string, width: number) =>
    (doc.splitTextToSize(text, width, { fontSize: 11 }) as string[]).length;
  if (section.kind === "paragraph") return measure(section.body, CONTENT_WIDTH);
  if (section.kind === "pairs") return section.pairs.length ? 1 + measure(section.pairs[0].value, CONTENT_WIDTH - 12) : 0;
  return section.items.length ? measure(section.items[0], CONTENT_WIDTH - 18) : 0;
}

/** Matches the in-app icons: circle (low), diamond (medium), triangle (high). */
function drawRiskShape(doc: Doc, level: RiskLevel, x: number, y: number) {
  const r = 4.5;
  if (level === "LOW") doc.circle(x, y, r, "F");
  else if (level === "MEDIUM") {
    doc.triangle(x - r, y, x, y - r, x + r, y, "F");
    doc.triangle(x - r, y, x, y + r, x + r, y, "F");
  } else doc.triangle(x - r, y + r, x, y - r, x + r, y + r, "F");
}

const REPORT_FILENAME = "data-governance-assessment.pdf";

/** Throws on failure so the caller can show an error. */
export async function downloadAssessmentReport(
  input: AssessmentInput,
  result: AssessmentResult,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const doc = await renderAssessmentPdf(buildReportModel(input, result));
  if (!signal?.aborted) doc.save(REPORT_FILENAME);
}
