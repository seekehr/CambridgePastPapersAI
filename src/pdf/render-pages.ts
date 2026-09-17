import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import type { RenderedPage } from "../types/pdf-page.js";
import { withPdfDocument } from "./pdf-document.js";

export interface RenderPagesOptions {
  outputDir: string;
  /** PDF.js render scale. Scale 2 is approximately 144 DPI. */
  scale?: number;
  filenamePrefix?: string;
}

/** Renders every PDF page to a lossless PNG image. */
export async function renderPages(
  inputPath: string,
  options: RenderPagesOptions,
): Promise<RenderedPage[]> {
  const scale = options.scale ?? 2;

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Render scale must be a positive number; received ${scale}.`);
  }

  const outputDir = resolve(options.outputDir);
  const filenamePrefix = options.filenamePrefix ?? "page";
  await mkdir(outputDir, { recursive: true });

  return withPdfDocument(inputPath, async (document) => {
    const renderedPages: RenderedPage[] = [];
    const pageDigits = Math.max(4, String(document.numPages).length);

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const filename = `${filenamePrefix}-${String(pageNumber).padStart(
        pageDigits,
        "0",
      )}.png`;
      const imagePath = resolve(outputDir, filename);
      await writeFile(imagePath, canvas.toBuffer("image/png"));

      renderedPages.push({
        pageNumber,
        path: imagePath,
        width,
        height,
        scale,
      });

      page.cleanup();
    }

    return renderedPages;
  });
}
