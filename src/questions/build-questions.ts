import type { QuestionCandidate } from "./segment-questions.js";
import {
  QuestionSchema,
  type GeminiQuestionData,
  type Question,
} from "../schema/question.js";

function normalizedTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1) ?? [];
}

function isReliableVerbatimText(modelText: string, sourceText: string): boolean {
  const modelTokens = normalizedTokens(modelText);

  if (modelTokens.length === 0) {
    return false;
  }

  const sourceTokens = new Set(normalizedTokens(sourceText));
  const matches = modelTokens.filter((token) => sourceTokens.has(token)).length;
  return matches / modelTokens.length >= 0.72;
}

function printedMarks(text: string): number | null {
  const matches = [...text.matchAll(/\[\s*(\d{1,3})\s*\]/gu)];

  if (matches.length !== 1) {
    return null;
  }

  return Number(matches[0]![1]);
}

function withoutTrailingMarkAllocation(text: string): string {
  return text.replace(/\s*\[\s*\d{1,3}\s*\]\s*$/u, "").trim();
}

function optionalValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildQuestions(
  candidates: QuestionCandidate[],
  geminiData: GeminiQuestionData[],
): Question[] {
  const dataByCandidate = new Map(
    geminiData.map((data) => [data.candidateId, data] as const),
  );

  return candidates.map((candidate) => {
    const data = dataByCandidate.get(candidate.id);

    if (!data) {
      throw new Error(`Missing Gemini data for ${candidate.id}.`);
    }

    const modelText = data.text?.trim();
    const sourceQuestionText = withoutTrailingMarkAllocation(candidate.text);
    const text =
      modelText && isReliableVerbatimText(modelText, candidate.text)
        ? modelText
        : sourceQuestionText;
    const localMarks = printedMarks(candidate.text);
    const topic = optionalValue(data.topic);
    const subtopic = optionalValue(data.subtopic);
    const questionType = optionalValue(data.questionType);

    return QuestionSchema.parse({
      number: candidate.number,
      text,
      marks: localMarks ?? data.marks,
      page: candidate.startPage,
      ...(topic ? { topic } : {}),
      ...(subtopic ? { subtopic } : {}),
      ...(questionType ? { questionType } : {}),
    });
  });
}
