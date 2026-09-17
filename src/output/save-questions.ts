import { writeFile } from "node:fs/promises";

import {
  QuestionDocumentSchema,
  type Question,
  type QuestionDocument,
} from "../schema/question.js";

function serializeQuestionDocument(document: QuestionDocument): string {
  const lines = [
    "{",
    `  \"source\": ${JSON.stringify(document.source)},`,
    `  \"model\": ${JSON.stringify(document.model)},`,
    `  \"generatedAt\": ${JSON.stringify(document.generatedAt)},`,
    '  "questions": [',
    ...document.questions.map(
      (question, index) =>
        `    ${JSON.stringify(question)}${
          index < document.questions.length - 1 ? "," : ""
        }`,
    ),
    "  ]",
    "}",
  ];

  return `${lines.length <= 1_000 ? lines.join("\n") : JSON.stringify(document)}\n`;
}

export async function saveQuestions(
  outputPath: string,
  source: string,
  model: string,
  questions: Question[],
): Promise<QuestionDocument> {
  const document = QuestionDocumentSchema.parse({
    source,
    model,
    generatedAt: new Date().toISOString(),
    questions,
  });

  await writeFile(outputPath, serializeQuestionDocument(document), "utf8");
  return document;
}
