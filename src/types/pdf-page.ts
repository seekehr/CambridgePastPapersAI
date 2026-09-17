/**
 * A rectangle in PDF.js viewport coordinates at scale 1 (72 CSS pixels/inch).
 * The origin is the top-left corner and values are [left, top, right, bottom].
 */
export type BoundingBox = [number, number, number, number];

export type PdfTransform = [number, number, number, number, number, number];

export interface TextFragment {
  text: string;
  bbox: BoundingBox;
  transform: PdfTransform;
  fontName: string;
  direction: string;
  hasEOL: boolean;
}

export interface ExtractedPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  fragments: TextFragment[];
}
