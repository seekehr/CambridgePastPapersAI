# CambridgePastPapersAI

This repository starts with a layout-preserving PDF ingestion layer. It extracts
text page by page **and** retains positioned text fragments, while rendering every
page to a lossless PNG so diagrams, tables, equations, and spatial context remain
available to later pipeline stages.

## Proposed structure

```text
src/
├── cli.ts                         # runnable entry point
├── pipeline/
│   └── ingest-papers.ts           # scans and ingests all source PDFs
├── pdf/
│   ├── pdf-document.ts            # PDF loading and lifecycle
│   ├── extract-pages.ts           # implemented: text + coordinates per page
│   └── render-pages.ts            # implemented: full-page PNGs
├── types/
│   └── pdf-page.ts                # page, fragment, image, and bbox contracts
├── questions/
│   └── segment-questions.ts       # next: 1, 1(a), 1(a)(i) boundaries
├── visual/
│   └── attach-visual-context.ts   # next: full pages, later bbox crops
├── llm/
│   └── extract-question-data.ts   # next: constrained structured extraction
├── schema/
│   └── question.ts                # next: Zod source-of-truth schema
└── output/
    └── save-results.ts            # next: normalized JSON
```

Only the `pdf/` and shared `types/` layers are implemented in this milestone.
The unimplemented paths above describe module boundaries; they are deliberately
not placeholder source files.

## Library choices

- **Text extraction: `pdfjs-dist`**. It exposes page-level text items, transforms,
  font names, directions, and dimensions. The pipeline therefore keeps a readable
  `text` field plus `fragments` with bounding boxes and raw transforms rather than
  flattening the PDF into an unstructured string.
- **Page rendering: `pdfjs-dist` + `@napi-rs/canvas`**. This uses the same page
  viewport for extraction and rendering and ships prebuilt native canvas binaries.
  PNG is lossless and is a good default for small labels and line diagrams.
- **Image handling (next milestone): `sharp`**. It is suitable for cropping bbox
  regions, resizing model inputs, normalization, and format conversion.
- **Validation (next milestone): `zod`**. The Zod schema should be the runtime
  source of truth, with `z.infer` producing the TypeScript `Question` type.

Bounding boxes are `[left, top, right, bottom]` in the scale-1 PDF.js viewport,
with a top-left origin. A later cropper can multiply them by the selected render
scale before calling `sharp.extract()`. Raw PDF.js transforms are also retained.

## Run

Node.js 22.13 or newer is required.

```powershell
npm install
npm run ingest
```

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
    │   └── pages/
    │       ├── page-0001.png
    │       └── ...
    └── physics/
        └── mechanics-paper/
            ├── extracted-pages.json
            └── pages/
                └── ...
```

The CLI manifest is an inspection artifact for this first milestone, not the final
normalized question JSON. The PDF inputs and generated files are ignored by Git,
while `.gitkeep` files preserve both expected data directories in a fresh checkout.

`extracted-pages.json` uses compact page-level formatting and never exceeds 1,000
lines. Each extracted and rendered page normally occupies one line. Extremely long
documents fall back to one-line minified JSON without discarding text, coordinates,
or image metadata.

## Verify

```powershell
npm run typecheck
npm test
```
