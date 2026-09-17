import { resolve } from "node:path";

import { loadEnvironment } from "./config/environment.js";
import {
  ingestPastPapers,
  type IngestionEvent,
} from "./pipeline/ingest-papers.js";

function important(message: string): void {
  console.log(`[IMPORTANT] ${message}`);
}

function logIngestionEvent(event: IngestionEvent): void {
  switch (event.type) {
    case "discovery":
      important(`Found ${event.count} PDF paper(s) in ${event.inputDir}`);
      break;
    case "paper-start":
      important(`Starting ${event.source}`);
      important(`Output target: ${event.outputDir}`);
      break;
    case "paper-reset":
      important(
        event.previouslyExisted
          ? `Deleted existing paper output: ${event.outputDir}`
          : `Creating new paper output: ${event.outputDir}`,
      );
      break;
    case "question-candidates":
      important(
        `Detected ${event.count} question candidate(s) in ${event.source}`,
      );
      break;
    case "gemini-progress":
      important(`${event.message} [${event.source}]`);
      break;
    case "questions-written":
      important(`Wrote ${event.count} validated question(s) to ${event.path}`);
      break;
    case "paper-complete":
      important(
        `Completed ${event.result.source}: ${event.result.pageCount} page(s)`,
      );
      break;
    case "paper-failed":
      console.error(
        `[IMPORTANT] FAILED ${event.failure.source}: ${event.failure.message}`,
      );
      break;
  }
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error(
      "This command does not accept input paths. Put PDFs in data/past_papers and run `npm run ingest`.",
    );
  }

  const environment = loadEnvironment();
  important(
    environment.envFileLoaded
      ? `Loaded environment file: ${environment.envFilePath}`
      : `No .env file found at ${environment.envFilePath}; using defaults and OS environment variables`,
  );
  important(`Gemini model: ${environment.geminiModel}`);
  important("Gemini input: compact question JSON only (file uploads disabled)");
  important(
    `Gemini fallback models: ${
      environment.geminiFallbackModels.join(", ") || "none"
    }`,
  );
  important(`Gemini batch size: ${environment.geminiBatchSize}`);
  important(`Gemini retries per batch: ${environment.geminiMaxRetries}`);
  important(
    `Gemini delay between batches: ${environment.geminiRequestDelayMs}ms`,
  );
  important(
    `Gemini API key: ${
      environment.geminiApiKeyConfigured ? "configured" : "NOT configured"
    } (value hidden)`,
  );
  important(`Past papers directory: ${resolve(environment.inputDir)}`);
  important(`Parsed papers directory: ${resolve(environment.outputDir)}`);

  if (!environment.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing. Add it to .env before running ingestion.",
    );
  }

  const summary = await ingestPastPapers({
    inputDir: environment.inputDir,
    outputDir: environment.outputDir,
    gemini: {
      apiKey: environment.geminiApiKey,
      model: environment.geminiModel,
      fallbackModels: environment.geminiFallbackModels,
      batchSize: environment.geminiBatchSize,
      maxRetries: environment.geminiMaxRetries,
      requestDelayMs: environment.geminiRequestDelayMs,
    },
    onEvent: logIngestionEvent,
  });

  if (summary.discovered === 0) {
    important("Nothing to parse. Add PDF files to the past papers directory.");
    return;
  }

  important(
    `Finished: ${summary.completed.length} parsed, ${summary.failed.length} failed`,
  );

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(
    `[IMPORTANT] FATAL: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
