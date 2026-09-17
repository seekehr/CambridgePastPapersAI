export { extractPages } from "./pdf/extract-pages.js";
export {
  MAX_MANIFEST_LINES,
  serializePageManifest,
  type PageManifest,
} from "./output/serialize-page-manifest.js";
export {
  ingestPastPapers,
  type FailedPaperResult,
  type IngestionSummary,
  type IngestPastPapersOptions,
  type ParsedPaperResult,
} from "./pipeline/ingest-papers.js";
export {
  renderPages,
  type RenderPagesOptions,
} from "./pdf/render-pages.js";
export type {
  BoundingBox,
  ExtractedPage,
  PdfTransform,
  RenderedPage,
  TextFragment,
} from "./types/pdf-page.js";
