import { mkdir, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { extractPages } from "../pdf/extract-pages.js";
import { renderPages } from "../pdf/render-pages.js";
import { serializePageManifest } from "../output/serialize-page-manifest.js";

export interface IngestPastPapersOptions {
  inputDir?: string;
  outputDir?: string;
  renderScale?: number;
}

export interface ParsedPaperResult {
  source: string;
  outputDir: string;
  manifestPath: string;
  pageCount: number;
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
  paperOutputDir: string,
  renderScale: number,
): Promise<ParsedPaperResult> {
  const imageDir = resolve(paperOutputDir, "pages");
  await mkdir(paperOutputDir, { recursive: true });

  const extractedPages = await extractPages(source);
  const renderedPages = await renderPages(source, {
    outputDir: imageDir,
    scale: renderScale,
  });
  const manifestPath = resolve(paperOutputDir, "extracted-pages.json");

  await writeFile(
    manifestPath,
    serializePageManifest({ source, extractedPages, renderedPages }),
    "utf8",
  );

  return {
    source,
    outputDir: paperOutputDir,
    manifestPath,
    pageCount: extractedPages.length,
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
  const renderScale = options.renderScale ?? 2;

  if (!Number.isFinite(renderScale) || renderScale <= 0) {
    throw new Error(
      `Render scale must be a positive number; received ${renderScale}.`,
    );
  }

  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
  ]);

  const pdfFiles = await findPdfFiles(inputDir);
  const completed: ParsedPaperResult[] = [];
  const failed: FailedPaperResult[] = [];

  // Sequential processing keeps memory predictable for large exam papers.
  for (const source of pdfFiles) {
    const paperOutputDir = outputDirectoryForPaper(
      inputDir,
      outputDir,
      source,
    );

    try {
      completed.push(
        await ingestPaper(source, paperOutputDir, renderScale),
      );
    } catch (error: unknown) {
      failed.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      });
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
