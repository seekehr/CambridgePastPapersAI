import { resolve } from "node:path";

import { loadEnvironment } from "./config/environment.js";
import {
  ingestPastPapers,
  type IngestionEvent,
} from "./pipeline/ingest-papers.js";

/** Reserved for destructive actions, per-paper outcomes, and the run summary. */
function important(message: string): void {
  console.log(`[IMPORTANT] ${message}`);
}

function info(message: string): void {
  console.log(message);
}

function logIngestionEvent(event: IngestionEvent): void {
  switch (event.type) {
    case "discovery":
      important(`Found ${event.count} PDF paper(s) in ${event.inputDir}`);
      break;
    case "paper-start":
      info(`Starting ${event.source}`);
      info(`Output target: ${event.outputDir}`);
      break;
    case "paper-reset":
      if (event.previouslyExisted) {
        important(`Deleted existing paper output: ${event.outputDir}`);
      } else {
        info(`Creating new paper output: ${event.outputDir}`);
      }
      break;
    case "question-candidates":
      info(`Detected ${event.count} question candidate(s) in ${event.source}`);
      break;
    case "gemini-progress":
      info(`${event.message} [${event.source}]`);
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
  info(
    environment.envFileLoaded
      ? `Loaded environment file: ${environment.envFilePath}`
      : `No .env file found at ${environment.envFilePath}; using defaults and OS environment variables`,
  );
  info(`Gemini model: ${environment.geminiModel}`);
  info("Gemini input: compact question JSON only (file uploads disabled)");
  info(
    `Gemini fallback models: ${
      environment.geminiFallbackModels.join(", ") || "none"
    }`,
  );
  info(`Gemini batch size: ${environment.geminiBatchSize}`);
  info(`Gemini retries per batch: ${environment.geminiMaxRetries}`);
  info(`Gemini delay between batches: ${environment.geminiRequestDelayMs}ms`);
  info(
    `Gemini API key: ${
      environment.geminiApiKeyConfigured ? "configured" : "NOT configured"
    } (value hidden)`,
  );
  info(`Past papers directory: ${resolve(environment.inputDir)}`);
  info(`Parsed papers directory: ${resolve(environment.outputDir)}`);

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
