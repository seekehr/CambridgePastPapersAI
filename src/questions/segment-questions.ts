import type { ExtractedPage } from "../types/pdf-page.js";
import { groupTextFragments } from "../pdf/text-layout.js";

export interface QuestionCandidate {
  id: string;
  number: string;
  text: string;
  startPage: number;
  endPage: number;
  pageNumbers: number[];
}

interface PageLine {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  left: number;
  top: number;
  text: string;
}

interface QuestionAnchor {
  number: string;
  content: string;
  topLevel: number;
  letter?: string;
  roman?: string;
}

interface SegmentationState {
  topLevel?: number;
  letter?: string;
  roman?: string;
}

interface RawQuestionSegment {
  number: string;
  text: string;
  pageNumbers: number[];
  hierarchy: string[];
}

function linesFromFragments(page: ExtractedPage): PageLine[] {
  return groupTextFragments(page.fragments).map((line) => ({
    pageNumber: page.pageNumber,
    pageWidth: page.width,
    pageHeight: page.height,
    left: line.left,
    top: line.top,
    text: line.text,
  }));
}

/**
 * Copyright acknowledgements sit in a block at the foot of a paper's final
 * page. Its opening sentence and every line below it are boilerplate, so the
 * page is truncated there instead of letting the block run into the last
 * question. Individual boilerplate lines are still dropped by cleanLineText.
 */
const COPYRIGHT_FOOTER_START =
  /^(?:Permission to reproduce items where|To avoid the issue of disclosure)/iu;

function withoutCopyrightFooter(lines: PageLine[]): PageLine[] {
  const start = lines.findIndex(
    (line) =>
      line.top > line.pageHeight * 0.5 &&
      COPYRIGHT_FOOTER_START.test(line.text.replace(/\s+/gu, " ").trim()),
  );

  return start === -1 ? lines : lines.slice(0, start);
}

function linesFromPage(page: ExtractedPage): PageLine[] {
  if (page.fragments.length > 0) {
    return withoutCopyrightFooter(linesFromFragments(page));
  }

  return withoutCopyrightFooter(
    page.text
      .split(/\r?\n/u)
      .map((text, index) => ({
        pageNumber: page.pageNumber,
        pageWidth: page.width,
        pageHeight: page.height,
        left: 0,
        top: index * 12,
        text: text.trim(),
      }))
      .filter((line) => line.text.length > 0),
  );
}

function cleanLineText(line: PageLine): string | undefined {
  const text = line.text.replace(/\s+/gu, " ").trim();

  if (line.top < line.pageHeight * 0.055 || line.top > line.pageHeight * 0.92) {
    return undefined;
  }

  if (/[\u0000-\u001F\u007F]/u.test(text)) {
    return undefined;
  }

  if (
    /DO NOT WRITE (?:IN THIS MARGIN|OUTSIDE THE BOX)/iu.test(text) ||
    /^(?:©\s*)?UCLES\b/iu.test(text) ||
    /^©\s*Cambridge\b/iu.test(text) ||
    /^Cambridge (?:Assessment )?(?:International|University Press)/iu.test(
      text,
    ) ||
    /^Acknowledgements Booklet\b/iu.test(text) ||
    /^University of Cambridge\.?$/iu.test(text) ||
    /^Trace ID:/iu.test(text) ||
    /^Re-uploading, mirroring or re-hosting/iu.test(text) ||
    /^Licensed for hosting on /iu.test(text) ||
    /^Permission to reproduce items where/iu.test(text) ||
    /^PapaCambridge/iu.test(text) ||
    /^BLANK PAGE$/iu.test(text) ||
    /^\[?Turn over\]?$/iu.test(text) ||
    /^\d{4}\/\d{2}\/[A-Z]\/[A-Z]\/[0-9]{2}$/iu.test(text)
  ) {
    return undefined;
  }

  const asciiCharacters = text.match(/[\x20-\x7E]/gu)?.length ?? 0;

  if (line.top > line.pageHeight * 0.85 && asciiCharacters / text.length < 0.5) {
    return undefined;
  }

  if (line.top > line.pageHeight * 0.93 && /^\d{1,3}$/u.test(text)) {
    return undefined;
  }

  const answerLine = text.match(/^[._·…\s-]+(?:\[\s*(\d{1,3})\s*\])?$/u);

  if (answerLine) {
    return answerLine[1] ? `[${answerLine[1]}]` : undefined;
  }

  return text || undefined;
}

function questionHierarchy(number: string): string[] {
  const topLevel = number.match(/^\d+/u)?.[0];

  if (!topLevel) {
    return [];
  }

  return [
    topLevel,
    ...[...number.matchAll(/\(([^)]+)\)/gu)].map((match) => match[1]!),
  ];
}

function isAncestor(
  ancestor: RawQuestionSegment,
  descendant: RawQuestionSegment,
): boolean {
  return (
    ancestor.hierarchy.length < descendant.hierarchy.length &&
    ancestor.hierarchy.every(
      (part, index) => descendant.hierarchy[index] === part,
    )
  );
}

function isNextLetter(previous: string | undefined, candidate: string): boolean {
  return previous !== undefined &&
    candidate.charCodeAt(0) === previous.charCodeAt(0) + 1;
}

function parseAnchor(
  line: PageLine,
  state: SegmentationState,
): QuestionAnchor | undefined {
  if (line.left > line.pageWidth * 0.24) {
    return undefined;
  }

  const topLevelMatch = line.text.match(
    /^(\d{1,2})(?:\s*\(([a-z])\))?(?:\s*\(([ivxlcdm]+)\))?(?=\s|[.:;-]|$)/iu,
  );

  if (topLevelMatch) {
    const topLevel = Number(topLevelMatch[1]);
    const letter = topLevelMatch[2]?.toLowerCase();
    const roman = topLevelMatch[3]?.toLowerCase();
    const isFirstQuestion = state.topLevel === undefined && topLevel === 1;
    const isNextQuestion =
      state.topLevel !== undefined && topLevel === state.topLevel + 1;
    const isCurrentQuestionPart =
      state.topLevel === topLevel && letter !== undefined;

    if (!isFirstQuestion && !isNextQuestion && !isCurrentQuestionPart) {
      return undefined;
    }

    return {
      number: `${topLevel}${letter ? `(${letter})` : ""}${
        roman ? `(${roman})` : ""
      }`,
      content: line.text.slice(topLevelMatch[0].length).trim(),
      topLevel,
      ...(letter ? { letter } : {}),
      ...(roman ? { roman } : {}),
    };
  }

  if (state.topLevel === undefined) {
    return undefined;
  }

  const partMatch = line.text.match(
    /^\(([a-z]+)\)(?:\s*\(([ivxlcdm]+)\))?(?=\s|[.:;-]|$)/iu,
  );

  if (!partMatch) {
    return undefined;
  }

  const first = partMatch[1]!.toLowerCase();
  const second = partMatch[2]?.toLowerCase();
  let letter: string | undefined;
  let roman: string | undefined;

  if (second) {
    letter = first;
    roman = second;
  } else if (first.length > 1) {
    roman = first;
    letter = state.letter;
  } else if (
    /^[ivx]$/u.test(first) &&
    state.letter !== undefined &&
    !isNextLetter(state.letter, first)
  ) {
    letter = state.letter;
    roman = first;
  } else {
    letter = first;
  }

  if (roman && !letter) {
    return undefined;
  }

  return {
    number: `${state.topLevel}${letter ? `(${letter})` : ""}${
      roman ? `(${roman})` : ""
    }`,
    content: line.text.slice(partMatch[0].length).trim(),
    topLevel: state.topLevel,
    ...(letter ? { letter } : {}),
    ...(roman ? { roman } : {}),
  };
}

/** Detects hierarchical Cambridge question labels while retaining page spans. */
export function segmentQuestions(pages: ExtractedPage[]): QuestionCandidate[] {
  const lines = pages.flatMap(linesFromPage);
  const state: SegmentationState = {};
  const segments: RawQuestionSegment[] = [];
  let current:
    | {
        number: string;
        lines: string[];
        pages: Set<number>;
      }
    | undefined;

  const finishCurrent = (): void => {
    if (!current) {
      return;
    }

    const text = current.lines.join("\n").replace(/[ \t]+/gu, " ").trim();

    if (text.length > 0) {
      const pageNumbers = [...current.pages].sort((left, right) => left - right);
      segments.push({
        number: current.number,
        text,
        pageNumbers,
        hierarchy: questionHierarchy(current.number),
      });
    }
  };

  for (const line of lines) {
    const cleanedText = cleanLineText(line);

    if (!cleanedText) {
      continue;
    }

    const cleanedLine = { ...line, text: cleanedText };
    const anchor = parseAnchor(cleanedLine, state);

    if (anchor) {
      finishCurrent();
      current = {
        number: anchor.number,
        lines: anchor.content ? [anchor.content] : [],
        pages: new Set([cleanedLine.pageNumber]),
      };
      state.topLevel = anchor.topLevel;

      if (anchor.letter === undefined) {
        delete state.letter;
      } else {
        state.letter = anchor.letter;
      }

      if (anchor.roman === undefined) {
        delete state.roman;
      } else {
        state.roman = anchor.roman;
      }
      continue;
    }

    if (current) {
      current.lines.push(cleanedLine.text);
      current.pages.add(cleanedLine.pageNumber);
    }
  }

  finishCurrent();

  const leaves = segments.filter(
    (segment) =>
      !segments.some((candidate) => isAncestor(segment, candidate)),
  );

  return leaves.map((leaf, index) => {
    const context = segments.filter(
      (segment) => isAncestor(segment, leaf),
    );
    const pageNumbers = [
      ...new Set(
        [...context, leaf].flatMap((segment) => segment.pageNumbers),
      ),
    ].sort((left, right) => left - right);
    const text = [...context, leaf]
      .map((segment) => segment.text)
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      id: `candidate-${String(index + 1).padStart(4, "0")}`,
      number: leaf.number,
      text,
      startPage: pageNumbers[0]!,
      endPage: pageNumbers.at(-1)!,
      pageNumbers,
    };
  });
}
