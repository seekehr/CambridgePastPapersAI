import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGeminiQuestionPrompt,
  buildQuestions,
  extractPages,
  ingestPastPapers,
  loadEnvironment,
  MAX_MANIFEST_LINES,
  segmentQuestions,
  serializePageManifest,
  type ExtractedPage,
  type GeminiQuestionData,
  type IngestionEvent,
  type TextFragment,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

function fragment(
  text: string,
  left: number,
  top: number,
  width: number,
  height = 10,
  rotated = false,
): TextFragment {
  return {
    text,
    bbox: [left, top, left + width, top + height],
    transform: rotated
      ? [0, -height, -height, 0, left, top + height]
      : [height, 0, 0, -height, left, top + height],
    fontName: "fixture-font",
    direction: "ltr",
    hasEOL: false,
  };
}

async function createFixture(): Promise<{ directory: string; pdfPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cambridge-pdf-test-"));
  temporaryDirectories.push(directory);

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage([595, 842]);
  firstPage.drawText("1 (a) State Newton's first law. [2]", {
    x: 72,
    y: 760,
    size: 14,
    font,
  });
  const secondPage = document.addPage([595, 842]);
  secondPage.drawText("1 (b) Use Fig. 1.1 to explain your answer. [3]", {
    x: 72,
    y: 760,
    size: 14,
    font,
  });
  secondPage.drawRectangle({
    x: 72,
    y: 500,
    width: 240,
    height: 120,
    borderWidth: 2,
  });

  const pdfPath = join(directory, "paper.pdf");
  const pdfBytes = await document.save();
  await writeFile(pdfPath, pdfBytes);

  return { directory, pdfPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PDF ingestion foundation", () => {
  it("extracts readable text and positioned fragments page by page", async () => {
    const { pdfPath } = await createFixture();
    const pages = await extractPages(pdfPath);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[0]?.text).toContain("Newton's first law");
    expect(pages[1]?.text).toContain("Fig. 1.1");
    expect(pages[0]?.fragments.length).toBeGreaterThan(0);
    expect(pages[0]?.fragments[0]?.bbox).toHaveLength(4);

    const candidates = segmentQuestions(pages);
    expect(candidates.map((candidate) => candidate.number)).toEqual([
      "1(a)",
      "1(b)",
    ]);
    expect(candidates.map((candidate) => candidate.startPage)).toEqual([1, 2]);
  });

  it("keeps powers on their line and emits inherited leaf boundaries", () => {
    const fragments = [
      fragment("1", 10, 20, 5),
      fragment("Write down the value of", 30, 20, 100),
      fragment("(a)", 30, 45, 15),
      fragment("5", 55, 45, 6),
      fragment("3", 61.5, 42, 4, 7),
      fragment("[1]", 150, 65, 15),
      fragment("(b)", 30, 90, 15),
      fragment("121.", 55, 90, 25),
      fragment("DO NOT WRITE IN THIS MARGIN", 0, 110, 120, 8, true),
      fragment("[1]", 150, 110, 15),
      fragment("2", 10, 140, 5),
      fragment("Next question.", 30, 140, 70),
    ];
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        width: 300,
        height: 200,
        rotation: 0,
        text: "",
        fragments,
      },
    ];

    const candidates = segmentQuestions(pages);

    expect(candidates.map((candidate) => candidate.number)).toEqual([
      "1(a)",
      "1(b)",
      "2",
    ]);
    expect(candidates[0]?.text).toContain("Write down the value of");
    expect(candidates[0]?.text).toContain("5^3");
    expect(candidates[1]?.text).toContain("121.");
    expect(candidates[1]?.text).not.toContain("DO NOT WRITE");
  });

  it("keeps roman subquestions separate and inherits their parent stem", () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        width: 300,
        height: 240,
        rotation: 0,
        text: "",
        fragments: [
          fragment("1", 10, 20, 5),
          fragment("Sequence questions.", 30, 20, 90),
          fragment("(a)", 30, 45, 15),
          fragment("These are the terms.", 55, 45, 90),
          fragment("(i)", 55, 70, 12),
          fragment("Find the rule.", 75, 70, 60),
          fragment("[1]", 160, 90, 15),
          fragment("(ii)", 55, 115, 16),
          fragment("Find the nth term.", 75, 115, 75),
          fragment("[2]", 160, 135, 15),
          fragment("(b)", 30, 165, 15),
          fragment("Find another value.", 55, 165, 85),
          fragment("[1]", 160, 185, 15),
        ],
      },
    ];

    const candidates = segmentQuestions(pages);

    expect(candidates.map((candidate) => candidate.number)).toEqual([
      "1(a)(i)",
      "1(a)(ii)",
      "1(b)",
    ]);
    expect(candidates[0]?.text).toContain("Sequence questions.");
    expect(candidates[0]?.text).toContain("These are the terms.");
    expect(candidates[0]?.text).toContain("Find the rule.");
    expect(candidates[1]?.text).toContain("Find the nth term.");
  });

  it("discovers all papers and mirrors nested input directories", async () => {
    const { directory, pdfPath } = await createFixture();
    const inputDir = join(directory, "past_papers");
    const nestedInputDir = join(inputDir, "physics");
    const nestedPdfPath = join(nestedInputDir, "mechanics.PDF");
    const outputDir = join(directory, "parsed_papers");
    const paperOutputDir = join(outputDir, "physics", "mechanics");
    const staleFile = join(paperOutputDir, "stale-page.png");
    const events: IngestionEvent[] = [];

    await mkdir(nestedInputDir, { recursive: true });
    await rename(pdfPath, nestedPdfPath);
    await mkdir(paperOutputDir, { recursive: true });
    await writeFile(staleFile, "stale output", "utf8");

    const summary = await ingestPastPapers({
      inputDir,
      outputDir,
      onEvent: (event) => events.push(event),
    });

    expect(summary.discovered).toBe(1);
    expect(summary.failed).toEqual([]);
    expect(summary.completed).toHaveLength(1);
    expect(summary.completed[0]?.outputDir).toBe(paperOutputDir);
    await expect(readFile(staleFile)).rejects.toThrow();
    expect(events).toContainEqual({
      type: "paper-reset",
      outputDir: paperOutputDir,
      previouslyExisted: true,
    });

    const manifestText = await readFile(
      summary.completed[0]!.manifestPath,
      "utf8",
    );
    expect(manifestText.trimEnd().split(/\r?\n/u).length).toBeLessThanOrEqual(
      MAX_MANIFEST_LINES,
    );

    const manifest = JSON.parse(manifestText) as {
      extractedPages: unknown[];
    };
    expect(manifest.extractedPages).toHaveLength(2);
  });

  it("minifies exceptionally long manifests to enforce the line limit", () => {
    const extractedPages = Array.from({ length: 1_200 }, (_, index) => ({
      pageNumber: index + 1,
      width: 595,
      height: 842,
      rotation: 0,
      text: `Page ${index + 1}`,
      fragments: [],
    }));
    const serialized = serializePageManifest({
      source: "long-paper.pdf",
      extractedPages,
    });

    expect(serialized.trimEnd().split(/\r?\n/u)).toHaveLength(1);
    expect(
      (JSON.parse(serialized) as { extractedPages: unknown[] }).extractedPages,
    ).toHaveLength(1_200);
  });

  it("loads supported settings from a project .env file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cambridge-env-test-"));
    temporaryDirectories.push(directory);
    const names = [
      "GEMINI_API_KEY",
      "GEMINI_MODEL",
      "GEMINI_FALLBACK_MODELS",
      "GEMINI_BATCH_SIZE",
      "GEMINI_MAX_RETRIES",
      "GEMINI_REQUEST_DELAY_MS",
      "PAST_PAPERS_DIR",
      "PARSED_PAPERS_DIR",
    ] as const;
    const originalValues = new Map(
      names.map((name) => [name, process.env[name]] as const),
    );

    for (const name of names) {
      delete process.env[name];
    }

    try {
      await writeFile(
        join(directory, ".env"),
        [
          "GEMINI_API_KEY=test-secret",
          "GEMINI_MODEL=test-model",
          "GEMINI_FALLBACK_MODELS=fallback-one, fallback-two",
          "GEMINI_BATCH_SIZE=7",
          "GEMINI_MAX_RETRIES=4",
          "GEMINI_REQUEST_DELAY_MS=2500",
          "PAST_PAPERS_DIR=custom/input",
          "PARSED_PAPERS_DIR=custom/output",
          "",
        ].join("\n"),
        "utf8",
      );

      const environment = loadEnvironment(directory);

      expect(environment.envFileLoaded).toBe(true);
      expect(environment.geminiApiKeyConfigured).toBe(true);
      expect(environment.geminiApiKey).toBe("test-secret");
      expect(environment.geminiModel).toBe("test-model");
      expect(environment.geminiFallbackModels).toEqual([
        "fallback-one",
        "fallback-two",
      ]);
      expect(environment.geminiBatchSize).toBe(7);
      expect(environment.geminiMaxRetries).toBe(4);
      expect(environment.geminiRequestDelayMs).toBe(2_500);
      expect(environment.inputDir).toBe("custom/input");
      expect(environment.outputDir).toBe("custom/output");
    } finally {
      for (const name of names) {
        const originalValue = originalValues.get(name);

        if (originalValue === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = originalValue;
        }
      }
    }
  });

  it("builds a compact JSON-only Gemini prompt without duplicating text", () => {
    const prompt = buildGeminiQuestionPrompt(
      [
        {
          id: "candidate-0001",
          number: "1(a)",
          text: "State Newton's first law. [2]",
          startPage: 3,
          endPage: 3,
          pageNumbers: [3],
        },
      ],
    );

    expect(prompt).toContain('"candidateId":"candidate-0001"');
    expect(prompt).toContain('"pageNumbers":[3]');
    expect(prompt).toContain("No PDF or image is attached");
    expect(prompt).toContain("text must be null");
  });

  it("builds validated questions and rejects unsupported Gemini wording", () => {
    const candidates = [
      {
        id: "candidate-0001",
        number: "1(a)",
        text: "State Newton's first law. [2]",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
      },
      {
        id: "candidate-0002",
        number: "1(b)",
        text: "Use Fig. 1.1 to explain your answer. [3]",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
      },
    ];
    const geminiData: GeminiQuestionData[] = [
      {
        candidateId: "candidate-0001",
        text: "Describe an unrelated banana experiment.",
        marks: 99,
        topic: "Mechanics",
        subtopic: "Newton's laws",
        questionType: "Recall",
      },
      {
        candidateId: "candidate-0002",
        text: "Use Fig. 1.1 to explain your answer.",
        marks: 3,
        topic: null,
        subtopic: null,
        questionType: null,
      },
    ];
    const questions = buildQuestions(candidates, geminiData);

    expect(questions[0]?.text).toBe("State Newton's first law.");
    expect(questions[0]?.marks).toBe(2);
    expect(questions[0]).not.toHaveProperty("images");
    expect(questions[1]).not.toHaveProperty("images");
  });
});
