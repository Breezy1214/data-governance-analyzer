// @vitest-environment node
// Node's File already implements text(), slice() and arrayBuffer(); jsdom's does not.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { DESCRIPTION_MAX_LENGTH } from "../lib/assessment";
import {
  DocumentImportError,
  MAX_FILE_BYTES,
  extractDocumentText,
  tidy,
} from "../lib/document-import";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

// The app gets its worker from the bundler; under the test runner we point
// pdf.js at the file on disk.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
).toString();

function fileFrom(name: string, body: Uint8Array | string, type = ""): File {
  return new File([body as BlobPart], name, { type });
}

describe("document import", () => {
  it("reads a plain text file", async () => {
    const imported = await extractDocumentText(
      fileFrom("use-case.txt", "We want to share customer emails with a partner."),
    );
    expect(imported.text).toBe("We want to share customer emails with a partner.");
    expect(imported.fileName).toBe("use-case.txt");
    expect(imported.truncated).toBe(false);
  });

  it("extracts text from a PDF", async () => {
    const imported = await extractDocumentText(fileFrom("brief.pdf", fixture("sample.pdf")));
    expect(imported.text).toContain("customer email addresses");
    expect(imported.text).toContain("record matching");
  });

  it("extracts text from a Word document", async () => {
    const imported = await extractDocumentText(fileFrom("brief.docx", fixture("sample.docx")));
    expect(imported.text).toContain("patient survey answers");
  });

  it("truncates to the description limit and says so", async () => {
    const long = "word ".repeat(DESCRIPTION_MAX_LENGTH);
    const imported = await extractDocumentText(fileFrom("long.txt", long));
    expect(imported.text.length).toBe(DESCRIPTION_MAX_LENGTH);
    expect(imported.truncated).toBe(true);
  });

  it("marks a text file truncated when only its start is read", async () => {
    const imported = await extractDocumentText(fileFrom("big.txt", `Short summary.${" ".repeat(70 * 1024)}tail`));
    expect(imported.text).toBe("Short summary.");
    expect(imported.truncated).toBe(true);
  });

  it("rejects an unsupported file type with advice, not a stack trace", async () => {
    await expect(extractDocumentText(fileFrom("notes.pages", "x"))).rejects.toBeInstanceOf(DocumentImportError);
    await expect(extractDocumentText(fileFrom("notes.pages", "x"))).rejects.toThrow(/not supported/i);
  });

  it("rejects an empty file", async () => {
    await expect(extractDocumentText(fileFrom("empty.txt", ""))).rejects.toThrow(/empty/i);
  });

  it("rejects a file over the size limit before parsing it", async () => {
    const big = fileFrom("big.txt", "x");
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    await expect(extractDocumentText(big)).rejects.toThrow(/larger than/i);
  });

  it("explains that a PDF with no text layer is not supported", async () => {
    // A structurally valid PDF whose page has no text operators.
    const empty = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
      "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n";
    await expect(extractDocumentText(fileFrom("scan.pdf", empty))).rejects.toThrow(/scanned|could not be read/i);
  });

  it("never leaks the parser's own error text", async () => {
    const broken = fileFrom("broken.docx", "this is not a zip archive");
    await expect(extractDocumentText(broken)).rejects.toThrow(/could not be read/i);
  });

  it("tidies whitespace so extracted text reads as prose", () => {
    expect(tidy("Line one.\r\n\r\n\r\n   Line   two.  \n")).toBe("Line one.\n\nLine two.");
  });
});
