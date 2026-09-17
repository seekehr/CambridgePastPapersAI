import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

export interface AppEnvironment {
  envFilePath: string;
  envFileLoaded: boolean;
  geminiApiKey: string | null;
  geminiApiKeyConfigured: boolean;
  geminiBatchSize: number;
  geminiFallbackModels: string[];
  geminiMaxRetries: number;
  geminiModel: string;
  geminiRequestDelayMs: number;
  inputDir: string;
  outputDir: string;
}

function envValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** Loads .env without overriding environment variables already set by the OS. */
export function loadEnvironment(cwd = process.cwd()): AppEnvironment {
  const envFilePath = resolve(cwd, ".env");
  let envFileLoaded = false;

  try {
    loadEnvFile(envFilePath);
    envFileLoaded = true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw new Error(`Could not load ${envFilePath}`, { cause: error });
    }
  }

  return {
    envFilePath,
    envFileLoaded,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
    geminiApiKeyConfigured:
      (process.env.GEMINI_API_KEY?.trim().length ?? 0) > 0,
    geminiBatchSize: Number(envValue("GEMINI_BATCH_SIZE", "40")),
    geminiFallbackModels: envValue(
      "GEMINI_FALLBACK_MODELS",
      "gemini-3.5-flash-lite,gemini-2.5-flash,gemini-3.6-flash",
    )
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    geminiMaxRetries: Number(envValue("GEMINI_MAX_RETRIES", "3")),
    geminiModel: envValue("GEMINI_MODEL", "gemini-3.8-flash"),
    geminiRequestDelayMs: Number(
      envValue("GEMINI_REQUEST_DELAY_MS", "3000"),
    ),
    inputDir: envValue("PAST_PAPERS_DIR", "data/past_papers"),
    outputDir: envValue("PARSED_PAPERS_DIR", "data/parsed_papers"),
  };
}
