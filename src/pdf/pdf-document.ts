import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DOMMatrix,
  Image,
  ImageData,
  Path2D,
} from "@napi-rs/canvas";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<
  ReturnType<PdfJs["getDocument"]>["promise"]
>;

let pdfJsPromise: Promise<PdfJs> | undefined;

function installCanvasGlobals(): void {
  const polyfills: ReadonlyArray<readonly [string, unknown]> = [
    ["DOMMatrix", DOMMatrix],
    ["ImageData", ImageData],
    ["Path2D", Path2D],
    ["Image", Image],
  ];

  for (const [name, implementation] of polyfills) {
    if (!Reflect.has(globalThis, name)) {
      Reflect.set(globalThis, name, implementation);
    }
  }
}

async function loadPdfJs(): Promise<PdfJs> {
  installCanvasGlobals();
  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsPromise;
}

async function readPdf(inputPath: string): Promise<Uint8Array> {
  const absolutePath = resolve(inputPath);
  const file = await stat(absolutePath).catch(() => undefined);

  if (!file?.isFile()) {
    throw new Error(`PDF input does not exist or is not a file: ${absolutePath}`);
  }

  const buffer = await readFile(absolutePath);
  const header = buffer.subarray(0, 1_024).toString("latin1");

  if (!header.includes("%PDF-")) {
    throw new Error(`Input does not appear to be a PDF: ${absolutePath}`);
  }

  // Copy the Buffer so PDF.js can safely transfer its underlying ArrayBuffer.
  return Uint8Array.from(buffer);
}

export async function withPdfDocument<T>(
  inputPath: string,
  useDocument: (document: PdfDocument, pdfJs: PdfJs) => Promise<T>,
): Promise<T> {
  const [pdfJs, data] = await Promise.all([loadPdfJs(), readPdf(inputPath)]);
  const loadingTask = pdfJs.getDocument({
    data,
    disableFontFace: false,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    return await useDocument(document, pdfJs);
  } finally {
    await loadingTask.destroy();
  }
}
