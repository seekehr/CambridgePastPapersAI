export { extractPages } from "./pdf/extract-pages.js";
export { buildQuestions } from "./questions/build-questions.js";
export {
  segmentQuestions,
  type QuestionCandidate,
} from "./questions/segment-questions.js";
export {
  extractQuestionDataWithGemini,
  type GeminiExtractionResult,
  type GeminiQuestionExtractorOptions,
  buildGeminiQuestionPrompt,
} from "./llm/gemini-question-extractor.js";
export {
  GeminiQuestionBatchSchema,
  GeminiQuestionDataSchema,
  QuestionDocumentSchema,
  QuestionSchema,
  type GeminiQuestionData,
  type Question,
  type QuestionDocument,
} from "./schema/question.js";
export { saveQuestions } from "./output/save-questions.js";
export {
  loadEnvironment,
  type AppEnvironment,
} from "./config/environment.js";
export {
  MAX_MANIFEST_LINES,
  serializePageManifest,
  type PageManifest,
} from "./output/serialize-page-manifest.js";
export {
  ingestPastPapers,
  type FailedPaperResult,
  type IngestionEvent,
  type GeminiPipelineOptions,
  type IngestionSummary,
  type IngestPastPapersOptions,
  type ParsedPaperResult,
} from "./pipeline/ingest-papers.js";
export type {
  BoundingBox,
  ExtractedPage,
  PdfTransform,
  TextFragment,
} from "./types/pdf-page.js";
