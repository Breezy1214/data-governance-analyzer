/**
 * mammoth ships no type declarations, and we use its prebuilt browser
 * bundle so .docx parsing stays in the browser. Only the one function we
 * call is declared here.
 */
declare module "mammoth/mammoth.browser" {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}
