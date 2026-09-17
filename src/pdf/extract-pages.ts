import type {
  BoundingBox,
  ExtractedPage,
  PdfTransform,
  TextFragment,
} from "../types/pdf-page.js";
import { withPdfDocument } from "./pdf-document.js";
import { createReadablePageText } from "./text-layout.js";

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Extracts page text without throwing away its layout coordinates.
 * Bounding boxes use a top-left origin and PDF.js scale-1 page units.
 */
export async function extractPages(inputPath: string): Promise<ExtractedPage[]> {
  return withPdfDocument(inputPath, async (document, pdfJs) => {
    const pages: ExtractedPage[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const fragments: TextFragment[] = [];

      for (const item of textContent.items) {
        if (!("str" in item) || item.str.length === 0) {
          continue;
        }

        const transform = pdfJs.Util.transform(
          viewport.transform,
          item.transform,
        ) as PdfTransform;
        const fontHeight = Math.hypot(transform[2], transform[3]);
        const left = transform[4];
        const baseline = transform[5];
        const bbox: BoundingBox = [
          round(left),
          round(baseline - fontHeight),
          round(left + item.width),
          round(baseline),
        ];

        fragments.push({
          text: item.str,
          bbox,
          transform: transform.map(round) as PdfTransform,
          fontName: item.fontName,
          direction: item.dir,
          hasEOL: item.hasEOL,
        });
      }

      pages.push({
        pageNumber,
        width: round(viewport.width),
        height: round(viewport.height),
        rotation: viewport.rotation,
        text: createReadablePageText(fragments),
        fragments,
      });

      page.cleanup();
    }

    return pages;
  });
}
