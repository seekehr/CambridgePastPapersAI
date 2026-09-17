import { GoogleGenAI } from "@google/genai";

import type { QuestionCandidate } from "../questions/segment-questions.js";
import {
  GeminiQuestionBatchSchema,
  type GeminiQuestionData,
} from "../schema/question.js";

export interface GeminiQuestionExtractorOptions {
  apiKey: string;
  model: string;
  fallbackModels?: string[];
  batchSize?: number;
  maxRetries?: number;
  requestDelayMs?: number;
  onProgress?: (message: string) => void;
}

export interface GeminiExtractionResult {
  questions: GeminiQuestionData[];
  modelsUsed: string[];
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateId: { type: "string" },
          text: { anyOf: [{ type: "string" }, { type: "null" }] },
          marks: {
            anyOf: [
              { type: "integer", minimum: 0 },
              { type: "null" },
            ],
          },
          topic: { anyOf: [{ type: "string" }, { type: "null" }] },
          subtopic: { anyOf: [{ type: "string" }, { type: "null" }] },
          questionType: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
        required: [
          "candidateId",
          "text",
          "marks",
          "topic",
          "subtopic",
          "questionType",
        ],
      },
    },
  },
  required: ["questions"],
} as const;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function retryDelayFor(error: unknown, attempt: number): number {
  const message = error instanceof Error ? error.message : String(error);
  const retrySeconds =
    message.match(/retryDelay[^0-9]*(\d+(?:\.\d+)?)s/iu)?.[1] ??
    message.match(/retry in (\d+(?:\.\d+)?)s/iu)?.[1];

  if (retrySeconds) {
    return Math.ceil(Number(retrySeconds) * 1_000) + 1_000;
  }

  return Math.min(2_000 * 2 ** attempt, 30_000);
}

function chunkCandidates(
  candidates: QuestionCandidate[],
  batchSize: number,
): QuestionCandidate[][] {
  const batches: QuestionCandidate[][] = [];

  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push(candidates.slice(index, index + batchSize));
  }

  return batches;
}

export function buildGeminiQuestionPrompt(
  candidates: QuestionCandidate[],
): string {
  const candidatePayload = candidates.map((candidate) => ({
    candidateId: candidate.id,
    detectedNumber: candidate.number,
    startPage: candidate.startPage,
    endPage: candidate.endPage,
    pageNumbers: candidate.pageNumbers,
    sourceText: candidate.text.slice(0, 16_000),
  }));

  return `Extract structured data for each supplied Cambridge past-paper question candidate.

Rules:
- Return exactly one record for every candidateId and no extra records.
- Use sourceText as the only evidence. No PDF or image is attached to this request.
- text must be null. Do not repeat sourceText; the pipeline preserves the locally extracted wording.
- Exclude page headers, footers, page codes, copyright notices, "DO NOT WRITE IN THIS MARGIN", dotted answer lines, and blank answer space.
- marks is the printed mark allocation for this exact candidate, or null. Never calculate or guess marks.
- topic, subtopic, and questionType must be concise and evidence-based. Return null when uncertain.
- Do not solve questions. Do not add explanations. Do not invent missing wording or metadata.

Candidates:
${JSON.stringify(candidatePayload)}`;
}

function validateBatchResponse(
  responseText: string,
  candidates: QuestionCandidate[],
): GeminiQuestionData[] {
  const parsed = GeminiQuestionBatchSchema.parse(JSON.parse(responseText));
  const expectedIds = new Set(candidates.map((candidate) => candidate.id));
  const returnedIds = new Set<string>();

  for (const question of parsed.questions) {
    if (!expectedIds.has(question.candidateId)) {
      throw new Error(
        `Gemini returned an unknown candidateId: ${question.candidateId}`,
      );
    }

    if (returnedIds.has(question.candidateId)) {
      throw new Error(
        `Gemini returned candidateId more than once: ${question.candidateId}`,
      );
    }

    returnedIds.add(question.candidateId);
  }

  const missing = [...expectedIds].filter((id) => !returnedIds.has(id));

  if (missing.length > 0) {
    throw new Error(`Gemini omitted candidateId values: ${missing.join(", ")}`);
  }

  return parsed.questions;
}

/** Sends only compact question-candidate JSON to Gemini. */
export async function extractQuestionDataWithGemini(
  candidates: QuestionCandidate[],
  options: GeminiQuestionExtractorOptions,
): Promise<GeminiExtractionResult> {
  const batchSize = options.batchSize ?? 40;
  const maxRetries = options.maxRetries ?? 2;
  const requestDelayMs = options.requestDelayMs ?? 3_000;

  if (!options.apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`Gemini batch size must be a positive integer: ${batchSize}`);
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`Gemini max retries must be a non-negative integer: ${maxRetries}`);
  }

  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0) {
    throw new Error(
      `Gemini request delay must be a non-negative integer: ${requestDelayMs}`,
    );
  }

  if (candidates.length === 0) {
    return { questions: [], modelsUsed: [] };
  }

  const client = new GoogleGenAI({ apiKey: options.apiKey });
  const models = [options.model, ...(options.fallbackModels ?? [])].filter(
    (model, index, allModels) =>
      model.trim().length > 0 && allModels.indexOf(model) === index,
  );
  const modelsUsed = new Set<string>();
  options.onProgress?.(
    "Using compact question-candidate JSON; PDF and image uploads are disabled",
  );
  const batches = chunkCandidates(candidates, batchSize);
  const extracted: GeminiQuestionData[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]!;
    let batchResult: GeminiQuestionData[] | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const model = models[attempt % models.length]!;
      options.onProgress?.(
        `Gemini batch ${batchIndex + 1}/${batches.length}, attempt ${attempt + 1}/${maxRetries + 1}, model ${model}`,
      );

      try {
        const contents = buildGeminiQuestionPrompt(batch);
        const response = await client.models.generateContent({
          model,
          contents,
          config: {
            responseMimeType: "application/json",
            responseJsonSchema,
            maxOutputTokens: 32_768,
            systemInstruction:
              "You are a conservative exam-document extraction system. Preserve source wording and use null instead of guessing.",
          },
        });
        const responseText = response.text;

        if (!responseText) {
          throw new Error("Gemini returned an empty response.");
        }

        batchResult = validateBatchResponse(responseText, batch);
        modelsUsed.add(model);
        break;
      } catch (error: unknown) {
        lastError = error;

        if (attempt < maxRetries) {
          const retryDelayMs = retryDelayFor(error, attempt);
          options.onProgress?.(
            `Gemini batch failed; retrying in ${retryDelayMs}ms: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          await delay(retryDelayMs);
        }
      }
    }

    if (!batchResult) {
      throw new Error(
        `Gemini batch ${batchIndex + 1} failed after ${maxRetries + 1} attempts: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    }

    extracted.push(...batchResult);

    if (batchIndex < batches.length - 1 && requestDelayMs > 0) {
      options.onProgress?.(
        `Pacing Gemini requests for ${requestDelayMs}ms before the next batch`,
      );
      await delay(requestDelayMs);
    }
  }

  return { questions: extracted, modelsUsed: [...modelsUsed] };
}
