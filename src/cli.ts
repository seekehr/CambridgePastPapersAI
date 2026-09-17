import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { extractPages } from "./pdf/extract-pages.js";
import { renderPages } from "./pdf/render-pages.js";

function printUsage(): void {
  console.log(
    "Usage: npm run ingest -- <paper.pdf> [--output data/paper] [--scale 2]",
  );
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      scale: { type: "string", default: "2" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const inputPath = positionals[0];

  if (values.help || !inputPath) {
    printUsage();
    process.exitCode = inputPath ? 0 : 1;
    return;
  }

  const paperName = basename(inputPath).replace(/\.pdf$/iu, "");
  const outputDir = resolve(values.output ?? `data/${paperName}`);
  const imageDir = resolve(outputDir, "pages");
  const scale = Number(values.scale);

  await mkdir(outputDir, { recursive: true });

  const extractedPages = await extractPages(inputPath);
  const renderedPages = await renderPages(inputPath, {
    outputDir: imageDir,
    scale,
  });

  const manifestPath = resolve(outputDir, "extracted-pages.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({ source: resolve(inputPath), extractedPages, renderedPages }, null, 2)}\n`,
    "utf8",
  );

  console.log(`Extracted ${extractedPages.length} pages.`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Page images: ${imageDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
