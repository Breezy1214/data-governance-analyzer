import { DESCRIPTION_MAX_LENGTH } from "./assessment";

/**
 * Document import for the describe step (SCRUM-23).
 *
 * Files are read and parsed entirely in the browser: nothing is uploaded,
 * which keeps the promise made in docs/data-handling.md. The parsers are
 * loaded on demand so they stay out of the initial bundle.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Kind = "text" | "pdf" | "docx";

const BY_EXTENSION: Record<string, Kind> = {
  txt: "text",
  md: "text",
  csv: "text",
  pdf: "pdf",
  docx: "docx",
};

/** What the file picker offers, and what the drop zone accepts. */
export const ACCEPTED_FILE_TYPES = Object.keys(BY_EXTENSION).map((extension) => `.${extension}`).join(",");
export const ACCEPTED_LABEL = "PDF, Word (.docx), or text";

export class DocumentImportError extends Error {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function kindFor(file: File): Kind {
  const kind = BY_EXTENSION[extensionOf(file.name)];
  if (!kind) {
    throw new DocumentImportError(
      `That file type is not supported. Upload ${ACCEPTED_LABEL}.`,
    );
  }
  return kind;
}

/** Collapses runs of whitespace so extracted text reads as prose. */
export function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ImportedDocument = {
  fileName: string;
  text: string;
  truncated: boolean;
};

/** Source text read so far, and whether the file holds more that was skipped. */
type Extracted = { raw: string; more: boolean };

/** Plenty of plain text to fill the description; the rest is never decoded. */
const TEXT_READ_BYTES = 64 * 1024;

async function readPdf(file: File): Promise<Extracted> {
  // The legacy build carries the polyfills pdf.js 6 needs (Promise.try,
  // Float16Array, Uint8Array.fromBase64). Without it the parser only runs on
  // Chrome 135+/Safari 26+/Node 24+, which our CI and many corporate browsers
  // are not.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // The bundler emits the worker asset and rewrites this URL. Tests set
  // workerSrc themselves, because the test runner cannot import this URL.
  pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, useWorkerFetch: false });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    // Stop once the description is full rather than parsing the whole document.
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
      page.cleanup();
      const raw = pages.join("\n\n");
      if (tidy(raw).length > DESCRIPTION_MAX_LENGTH) return { raw, more: number < doc.numPages };
    }
    return { raw: pages.join("\n\n"), more: false };
  } finally {
    await task.destroy();
  }
}

async function readDocx(file: File): Promise<Extracted> {
  // Declared in types/mammoth-browser.d.ts; the browser build keeps parsing local.
  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { raw: value, more: false };
}

async function readText(file: File): Promise<Extracted> {
  return { raw: await file.slice(0, TEXT_READ_BYTES).text(), more: file.size > TEXT_READ_BYTES };
}

/**
 * Reads a file and returns text ready for the description field. Throws a
 * DocumentImportError with a message meant for the person, not a log.
 */
export async function extractDocumentText(file: File): Promise<ImportedDocument> {
  const kind = kindFor(file);

  if (file.size === 0) {
    throw new DocumentImportError("That file is empty. Try another one, or type the description instead.");
  }
  if (file.size > MAX_FILE_BYTES) {
    const limit = Math.round(MAX_FILE_BYTES / (1024 * 1024));
    throw new DocumentImportError(`That file is larger than ${limit} MB. Upload a smaller one, or paste the relevant part.`);
  }

  let extracted: Extracted;
  try {
    extracted = await (kind === "pdf" ? readPdf(file) : kind === "docx" ? readDocx(file) : readText(file));
  } catch {
    // Never surface the parser's own error: it can quote file contents.
    throw new DocumentImportError("That file could not be read. It may be protected or damaged—try another, or type the description instead.");
  }

  const text = tidy(extracted.raw);
  if (!text) {
    throw new DocumentImportError(
      kind === "pdf"
        ? "No text could be read from that PDF. Scanned documents are not supported yet—type the description instead."
        : "No text could be read from that file. Type the description instead.",
    );
  }

  return {
    fileName: file.name,
    text: text.slice(0, DESCRIPTION_MAX_LENGTH),
    truncated: extracted.more || text.length > DESCRIPTION_MAX_LENGTH,
  };
}
