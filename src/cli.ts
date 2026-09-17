import { ingestPastPapers } from "./pipeline/ingest-papers.js";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error(
      "This command does not accept input paths. Put PDFs in data/past_papers and run `npm run ingest`.",
    );
  }

  const summary = await ingestPastPapers();

  if (summary.discovered === 0) {
    console.log(
      `No PDF files found in ${summary.inputDir}. Add papers there and run the command again.`,
    );
    return;
  }

  for (const paper of summary.completed) {
    console.log(
      `Parsed ${paper.source} (${paper.pageCount} pages) -> ${paper.outputDir}`,
    );
  }

  for (const failure of summary.failed) {
    console.error(`Failed ${failure.source}: ${failure.message}`);
  }

  console.log(
    `Finished: ${summary.completed.length} parsed, ${summary.failed.length} failed.`,
  );

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
