# CambridgePastPapersAI

This repository starts with a layout-preserving PDF ingestion layer. It extracts
text page by page **and** retains positioned text fragments, while rendering every
page to a lossless PNG so diagrams, tables, equations, and spatial context remain
available to later pipeline stages.

## Proposed structure

```text
src/
├── cli.ts                         # runnable entry point
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
npm run ingest -- .\path\to\paper.pdf --scale 2
```

The command writes:

```text
data/paper/
├── extracted-pages.json  # text, fragments, page geometry, and image manifest
└── pages/
    ├── page-0001.png
    ├── page-0002.png
    └── ...
```

The CLI manifest is an inspection artifact for this first milestone, not the final
normalized question JSON. Generated files under `data/` are ignored by Git, while
`data/.gitkeep` keeps the expected directory in a fresh checkout. Use `--output`
to select a different directory when needed.

## Verify

```powershell
npm run typecheck
npm test
```
