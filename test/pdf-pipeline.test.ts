import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import {
  extractPages,
  ingestPastPapers,
  MAX_MANIFEST_LINES,
  renderPages,
  serializePageManifest,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

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
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(pdfPath, pdfBytes),
  );

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
  });

  it("renders one lossless PNG per page", async () => {
    const { directory, pdfPath } = await createFixture();
    const pages = await renderPages(pdfPath, {
      outputDir: join(directory, "pages"),
      scale: 1.5,
    });

    expect(pages).toHaveLength(2);
    expect(pages[0]?.path).toMatch(/page-0001\.png$/u);

    const png = await readFile(pages[0]!.path);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const image = await loadImage(png);
    expect(image.width).toBe(Math.ceil(595 * 1.5));
    expect(image.height).toBe(Math.ceil(842 * 1.5));
  });

  it("discovers all papers and mirrors nested input directories", async () => {
    const { directory, pdfPath } = await createFixture();
    const inputDir = join(directory, "past_papers");
    const nestedInputDir = join(inputDir, "physics");
    const nestedPdfPath = join(nestedInputDir, "mechanics.PDF");
    const outputDir = join(directory, "parsed_papers");

    await mkdir(nestedInputDir, { recursive: true });
    await rename(pdfPath, nestedPdfPath);

    const summary = await ingestPastPapers({
      inputDir,
      outputDir,
      renderScale: 1,
    });

    expect(summary.discovered).toBe(1);
    expect(summary.failed).toEqual([]);
    expect(summary.completed).toHaveLength(1);
    expect(summary.completed[0]?.outputDir).toBe(
      join(outputDir, "physics", "mechanics"),
    );

    const manifestText = await readFile(
      summary.completed[0]!.manifestPath,
      "utf8",
    );
    expect(manifestText.trimEnd().split(/\r?\n/u).length).toBeLessThanOrEqual(
      MAX_MANIFEST_LINES,
    );

    const manifest = JSON.parse(manifestText) as {
      extractedPages: unknown[];
      renderedPages: unknown[];
    };
    expect(manifest.extractedPages).toHaveLength(2);
    expect(manifest.renderedPages).toHaveLength(2);
  });

  it("minifies exceptionally long manifests to enforce the line limit", () => {
    const extractedPages = Array.from({ length: 600 }, (_, index) => ({
      pageNumber: index + 1,
      width: 595,
      height: 842,
      rotation: 0,
      text: `Page ${index + 1}`,
      fragments: [],
    }));
    const renderedPages = Array.from({ length: 600 }, (_, index) => ({
      pageNumber: index + 1,
      path: `page-${index + 1}.png`,
      width: 1_190,
      height: 1_684,
      scale: 2,
    }));

    const serialized = serializePageManifest({
      source: "long-paper.pdf",
      extractedPages,
      renderedPages,
    });

    expect(serialized.trimEnd().split(/\r?\n/u)).toHaveLength(1);
    expect(
      (JSON.parse(serialized) as { extractedPages: unknown[] }).extractedPages,
    ).toHaveLength(600);
  });
});
