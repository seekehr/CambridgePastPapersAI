import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import { extractPages, renderPages } from "../src/index.js";

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
});
