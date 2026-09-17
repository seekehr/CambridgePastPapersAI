import { z } from "zod";

export const QuestionSchema = z.object({
  number: z.string().min(1),
  text: z.string().min(1),
  marks: z.number().int().nonnegative().nullable(),
  page: z.number().int().positive(),
  topic: z.string().min(1).optional(),
  subtopic: z.string().min(1).optional(),
  questionType: z.string().min(1).optional(),
});

export const QuestionDocumentSchema = z.object({
  source: z.string().min(1),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  questions: z.array(QuestionSchema),
});

export type Question = z.infer<typeof QuestionSchema>;
export type QuestionDocument = z.infer<typeof QuestionDocumentSchema>;

export const GeminiQuestionDataSchema = z.object({
  candidateId: z.string().min(1),
  text: z.string().min(1).nullable(),
  marks: z.number().int().nonnegative().nullable(),
  topic: z.string().min(1).nullable(),
  subtopic: z.string().min(1).nullable(),
  questionType: z.string().min(1).nullable(),
});

export const GeminiQuestionBatchSchema = z.object({
  questions: z.array(GeminiQuestionDataSchema),
});

export type GeminiQuestionData = z.infer<typeof GeminiQuestionDataSchema>;
