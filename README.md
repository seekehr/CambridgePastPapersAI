# CambridgePastPapersAI

This repository provides a page-aware PDF text-ingestion pipeline. It extracts
text page by page, retains positioned text fragments, detects question boundaries,
and sends compact candidate JSON to Gemini for structured output. The raw PDF is
never uploaded to Gemini, and the pipeline does not render or store page images.

## Structure

```text
src/
├── cli.ts                         # runnable entry point
├── pipeline/
│   └── ingest-papers.ts           # complete per-paper orchestration
├── pdf/
│   ├── pdf-document.ts            # PDF loading and lifecycle
│   └── extract-pages.ts           # text + coordinates per page
├── types/
│   └── pdf-page.ts                # page, fragment, and bbox contracts
├── questions/
│   ├── segment-questions.ts       # 1, 1(a), 1(a)(i) boundaries
│   └── build-questions.ts         # local merge and hallucination checks
├── llm/
│   └── gemini-question-extractor.ts
├── schema/
│   └── question.ts                # Zod source-of-truth schemas
└── output/
    ├── serialize-page-manifest.ts
    └── save-questions.ts
```

## Library choices

- **Text extraction: `pdfjs-dist`**. It exposes page-level text items, transforms,
  font names, directions, and dimensions. The pipeline therefore keeps a readable
  `text` field plus `fragments` with bounding boxes and raw transforms rather than
  flattening the PDF into an unstructured string.
- **AI extraction: `@google/genai`**. Gemini receives only compact JSON question
  candidates. There is deliberately no PDF or image upload path.
- **Validation: `zod`**. Zod is the runtime source of truth, with `z.infer`
  producing the TypeScript types.

Bounding boxes are `[left, top, right, bottom]` in the scale-1 PDF.js viewport,
with a top-left origin. Raw PDF.js transforms are also retained so text order and
layout clues are not flattened into one unstructured document-wide string.

## Run

Node.js 22.13 or newer is required.

```powershell
npm install
npm run ingest
```

The CLI automatically loads `.env` from the project root. Supported settings are:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite,gemini-2.5-flash,gemini-3.6-flash
GEMINI_BATCH_SIZE=40
GEMINI_MAX_RETRIES=3
GEMINI_REQUEST_DELAY_MS=3000
PAST_PAPERS_DIR=data/past_papers
PARSED_PAPERS_DIR=data/parsed_papers
```

Copy `.env.example` to `.env` and fill in values as needed. Startup logging reports
whether `GEMINI_API_KEY` is configured but never prints the key itself. Important
pipeline events are logged with an `[IMPORTANT]` prefix, including discovery,
per-paper output deletion, completion, failures, and the final summary.

Gemini receives only the segmented candidates needed for the current batch—not
the large `extracted-pages.json` manifest—and returns marks and classifications
without echoing the question wording. The application keeps the authoritative
local text, page numbers, and coordinates. Raw PDF and image uploads are not
implemented, so they cannot be enabled accidentally through configuration.

Place source PDFs anywhere below `data/past_papers/`. The command discovers them
recursively and mirrors their relative paths under `data/parsed_papers/`:

```text
data/
├── past_papers/
│   ├── biology-paper-2.pdf
│   └── physics/
│       └── mechanics-paper.pdf
└── parsed_papers/
    ├── biology-paper-2/
    │   ├── extracted-pages.json
    │   └── questions.json
    └── physics/
        └── mechanics-paper/
            ├── extracted-pages.json
            └── questions.json
```

`questions.json` is the normalized output. Page numbers are assigned by the
application, not Gemini. Gemini output is schema-constrained and
then validated with Zod; model wording that is not sufficiently supported by the
local text falls back to the extracted source wording. If AI extraction fails, the
paper directory retains its local text manifest and gets a compact
`question-extraction-error.json` diagnostic.

`extracted-pages.json` uses compact page-level formatting and never exceeds 1,000
lines. Each extracted page normally occupies one line. Extremely long documents
fall back to one-line minified JSON without discarding text or coordinates.

Before parsing a paper, the pipeline removes that paper's existing directory below
`data/parsed_papers/` and recreates it. This prevents stale output from surviving
when a source PDF is replaced with a shorter or revised version.

## Verify

```powershell
npm run typecheck
npm test
```
