import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { extractPages } from "../pdf/extract-pages.js";
import { serializePageManifest } from "../output/serialize-page-manifest.js";
import { saveQuestions } from "../output/save-questions.js";
import { buildQuestions } from "../questions/build-questions.js";
import { segmentQuestions } from "../questions/segment-questions.js";
import { extractQuestionDataWithGemini } from "../llm/gemini-question-extractor.js";

export interface GeminiPipelineOptions {
  apiKey: string;
  model: string;
  fallbackModels?: string[];
  batchSize?: number;
  maxRetries?: number;
  requestDelayMs?: number;
}

export interface IngestPastPapersOptions {
  inputDir?: string;
  outputDir?: string;
  onEvent?: (event: IngestionEvent) => void;
  gemini?: GeminiPipelineOptions;
}

export type IngestionEvent =
  | { type: "discovery"; count: number; inputDir: string }
  | { type: "paper-start"; source: string; outputDir: string }
  | { type: "paper-reset"; outputDir: string; previouslyExisted: boolean }
  | { type: "question-candidates"; source: string; count: number }
  | { type: "gemini-progress"; source: string; message: string }
  | {
      type: "questions-written";
      source: string;
      path: string;
      count: number;
    }
  | { type: "paper-complete"; result: ParsedPaperResult }
  | { type: "paper-failed"; failure: FailedPaperResult };

export interface ParsedPaperResult {
  source: string;
  outputDir: string;
  manifestPath: string;
  pageCount: number;
  candidateCount: number;
  questionCount: number;
  questionsPath: string | null;
}

export interface FailedPaperResult {
  source: string;
  message: string;
}

export interface IngestionSummary {
  inputDir: string;
  outputDir: string;
  discovered: number;
  completed: ParsedPaperResult[];
  failed: FailedPaperResult[];
}

async function findPdfFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findPdfFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function outputDirectoryForPaper(
  inputDir: string,
  outputDir: string,
  pdfPath: string,
): string {
  const relativePdfPath = relative(inputDir, pdfPath);
  const relativePaperPath = relativePdfPath.replace(/\.pdf$/iu, "");
  return resolve(outputDir, relativePaperPath);
}

async function ingestPaper(
  source: string,
  outputRoot: string,
  paperOutputDir: string,
  gemini: GeminiPipelineOptions | undefined,
  onEvent?: (event: IngestionEvent) => void,
): Promise<ParsedPaperResult> {
  const relativeOutputPath = relative(outputRoot, paperOutputDir);
  const isOutputRoot = relativeOutputPath === "";
  const isOutsideOutputRoot =
    relativeOutputPath === ".." ||
    relativeOutputPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutputPath);

  if (isOutputRoot || isOutsideOutputRoot) {
    throw new Error(
      `Refusing to reset unsafe paper output directory: ${paperOutputDir}`,
    );
  }

  const previouslyExisted = await lstat(paperOutputDir)
    .then(() => true)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    });

  await rm(paperOutputDir, { recursive: true, force: true });
  onEvent?.({ type: "paper-reset", outputDir: paperOutputDir, previouslyExisted });
  await mkdir(paperOutputDir, { recursive: true });

  const extractedPages = await extractPages(source);
  const manifestPath = resolve(paperOutputDir, "extracted-pages.json");

  await writeFile(
    manifestPath,
    serializePageManifest({ source, extractedPages }),
    "utf8",
  );

  let candidateCount = 0;
  let questionCount = 0;
  let questionsPath: string | null = null;

  if (gemini) {
    const candidates = segmentQuestions(extractedPages);
    candidateCount = candidates.length;
    onEvent?.({
      type: "question-candidates",
      source,
      count: candidateCount,
    });

    if (candidates.length === 0) {
      throw new Error(
        "No reliable question boundaries were detected; refusing to invent questions.",
      );
    }

    try {
      const geminiData = await extractQuestionDataWithGemini(candidates, {
          apiKey: gemini.apiKey,
          model: gemini.model,
          ...(gemini.fallbackModels === undefined
            ? {}
            : { fallbackModels: gemini.fallbackModels }),
          ...(gemini.batchSize === undefined
            ? {}
            : { batchSize: gemini.batchSize }),
          ...(gemini.maxRetries === undefined
            ? {}
            : { maxRetries: gemini.maxRetries }),
          ...(gemini.requestDelayMs === undefined
            ? {}
            : { requestDelayMs: gemini.requestDelayMs }),
          onProgress: (message) =>
            onEvent?.({
              type: "gemini-progress",
              source,
              message,
            }),
      });
      const questions = buildQuestions(candidates, geminiData.questions);
      questionsPath = resolve(paperOutputDir, "questions.json");
      await saveQuestions(
        questionsPath,
        source,
        geminiData.modelsUsed.join(", ") || gemini.model,
        questions,
      );
      questionCount = questions.length;
      onEvent?.({
        type: "questions-written",
        source,
        path: questionsPath,
        count: questionCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await writeFile(
        resolve(paperOutputDir, "question-extraction-error.json"),
        `${JSON.stringify({ source, stage: "gemini-question-extraction", message })}\n`,
        "utf8",
      );
      throw error;
    }
  }

  return {
    source,
    outputDir: paperOutputDir,
    manifestPath,
    pageCount: extractedPages.length,
    candidateCount,
    questionCount,
    questionsPath,
  };
}

/**
 * Parses every PDF in data/past_papers. Nested input directories are mirrored
 * below data/parsed_papers so equal filenames cannot overwrite one another.
 */
export async function ingestPastPapers(
  options: IngestPastPapersOptions = {},
): Promise<IngestionSummary> {
  const inputDir = resolve(options.inputDir ?? "data/past_papers");
  const outputDir = resolve(options.outputDir ?? "data/parsed_papers");

  if (options.gemini) {
    if (!options.gemini.apiKey.trim()) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    if (!options.gemini.model.trim()) {
      throw new Error("GEMINI_MODEL must not be empty.");
    }

    if (
      options.gemini.batchSize !== undefined &&
      (!Number.isInteger(options.gemini.batchSize) ||
        options.gemini.batchSize < 1)
    ) {
      throw new Error("GEMINI_BATCH_SIZE must be a positive integer.");
    }

    if (
      options.gemini.maxRetries !== undefined &&
      (!Number.isInteger(options.gemini.maxRetries) ||
        options.gemini.maxRetries < 0)
    ) {
      throw new Error("GEMINI_MAX_RETRIES must be a non-negative integer.");
    }

    if (
      options.gemini.requestDelayMs !== undefined &&
      (!Number.isInteger(options.gemini.requestDelayMs) ||
        options.gemini.requestDelayMs < 0)
    ) {
      throw new Error("GEMINI_REQUEST_DELAY_MS must be a non-negative integer.");
    }
  }

  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
  ]);

  const pdfFiles = await findPdfFiles(inputDir);
  options.onEvent?.({ type: "discovery", count: pdfFiles.length, inputDir });
  const completed: ParsedPaperResult[] = [];
  const failed: FailedPaperResult[] = [];

  // Sequential processing keeps memory predictable for large exam papers.
  for (const source of pdfFiles) {
    const paperOutputDir = outputDirectoryForPaper(
      inputDir,
      outputDir,
      source,
    );
    options.onEvent?.({ type: "paper-start", source, outputDir: paperOutputDir });

    try {
      const result = await ingestPaper(
        source,
        outputDir,
        paperOutputDir,
        options.gemini,
        options.onEvent,
      );
      completed.push(result);
      options.onEvent?.({ type: "paper-complete", result });
    } catch (error: unknown) {
      const failure = {
        source,
        message: error instanceof Error ? error.message : String(error),
      };
      failed.push(failure);
      options.onEvent?.({ type: "paper-failed", failure });
    }
  }

  return {
    inputDir,
    outputDir,
    discovered: pdfFiles.length,
    completed,
    failed,
  };
}
