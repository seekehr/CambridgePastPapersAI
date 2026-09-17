import type { ExtractedPage, RenderedPage } from "../types/pdf-page.js";

export const MAX_MANIFEST_LINES = 1_000;

export interface PageManifest {
  source: string;
  extractedPages: ExtractedPage[];
  renderedPages: RenderedPage[];
}

/**
 * Produces valid JSON with one compact line per extracted/rendered page. If an
 * unusually long document would exceed the cap, the entire manifest is safely
 * minified to one line without dropping any extraction data.
 */
export function serializePageManifest(
  manifest: PageManifest,
  maxLines = MAX_MANIFEST_LINES,
): string {
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error(`maxLines must be a positive integer; received ${maxLines}.`);
  }

  const lines = [
    "{",
    `  \"source\": ${JSON.stringify(manifest.source)},`,
    '  "extractedPages": [',
    ...manifest.extractedPages.map(
      (page, index) =>
        `    ${JSON.stringify(page)}${
          index < manifest.extractedPages.length - 1 ? "," : ""
        }`,
    ),
    "  ],",
    '  "renderedPages": [',
    ...manifest.renderedPages.map(
      (page, index) =>
        `    ${JSON.stringify(page)}${
          index < manifest.renderedPages.length - 1 ? "," : ""
        }`,
    ),
    "  ]",
    "}",
  ];

  if (lines.length > maxLines) {
    return `${JSON.stringify(manifest)}\n`;
  }

  return `${lines.join("\n")}\n`;
}
