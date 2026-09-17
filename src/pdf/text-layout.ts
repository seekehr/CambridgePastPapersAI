import type { TextFragment } from "../types/pdf-page.js";

export interface TextLine {
  fragments: TextFragment[];
  left: number;
  top: number;
  text: string;
}

function height(fragment: TextFragment): number {
  return fragment.bbox[3] - fragment.bbox[1];
}

function center(fragment: TextFragment): number {
  return (fragment.bbox[1] + fragment.bbox[3]) / 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Rotated margin text must not be mixed into horizontal question lines. */
export function isHorizontalFragment(fragment: TextFragment): boolean {
  return (
    Math.abs(fragment.transform[1]) < 0.01 &&
    Math.abs(fragment.transform[2]) < 0.01
  );
}

function sharesLine(
  fragments: TextFragment[],
  candidate: TextFragment,
): boolean {
  return fragments.some((fragment) => {
    const overlap =
      Math.min(fragment.bbox[3], candidate.bbox[3]) -
      Math.max(fragment.bbox[1], candidate.bbox[1]);
    const minimumHeight = Math.min(height(fragment), height(candidate));
    const centerDistance = Math.abs(center(fragment) - center(candidate));

    return (
      overlap >= minimumHeight * 0.3 ||
      centerDistance <= Math.max(height(fragment), height(candidate)) * 0.45
    );
  });
}

function scriptPrefix(
  fragment: TextFragment,
  maximumHeight: number,
  baseline: number,
): "" | "^" | "_" {
  if (height(fragment) > maximumHeight * 0.82) {
    return "";
  }

  const baselineDifference = fragment.bbox[3] - baseline;

  if (baselineDifference < -maximumHeight * 0.15) {
    return "^";
  }

  if (baselineDifference > maximumHeight * 0.15) {
    return "_";
  }

  return "";
}

/** Converts raised/lowered PDF glyph runs to plain-text x^2 and T_n notation. */
export function joinTextFragments(fragments: TextFragment[]): string {
  const ordered = fragments
    .filter(
      (fragment) =>
        isHorizontalFragment(fragment) && fragment.text.trim().length > 0,
    )
    .sort((left, right) => left.bbox[0] - right.bbox[0]);

  if (ordered.length === 0) {
    return "";
  }

  const maximumHeight = Math.max(...ordered.map(height));
  const normalFragments = ordered.filter(
    (fragment) => height(fragment) >= maximumHeight * 0.85,
  );
  const baseline = median(
    (normalFragments.length > 0 ? normalFragments : ordered).map(
      (fragment) => fragment.bbox[3],
    ),
  );
  let result = "";
  let previous: TextFragment | undefined;
  let activeScript: "" | "^" | "_" = "";

  for (const fragment of ordered) {
    const prefix = scriptPrefix(fragment, maximumHeight, baseline);
    const prefixMarker = prefix && prefix !== activeScript ? prefix : "";
    const text = fragment.text.trim();
    const gap = previous ? fragment.bbox[0] - previous.bbox[2] : 0;
    const needsSpace =
      result.length > 0 &&
      prefix === "" &&
      gap > 0.75 &&
      !/[\s(^_]$/u.test(result) &&
      !/^[,.;:!?%\])}]/u.test(text);

    result += `${needsSpace ? " " : ""}${prefixMarker}${text}`;
    activeScript = prefix;
    previous = fragment;
  }

  return result.trim();
}

/** Groups positioned horizontal fragments while keeping superscripts on their line. */
export function groupTextFragments(fragments: TextFragment[]): TextLine[] {
  const sorted = fragments
    .filter(
      (fragment) =>
        isHorizontalFragment(fragment) && fragment.text.trim().length > 0,
    )
    .sort((left, right) => {
      const vertical = fragmentTop(left) - fragmentTop(right);
      return Math.abs(vertical) > 0.5 ? vertical : left.bbox[0] - right.bbox[0];
    });
  const groups: TextFragment[][] = [];

  for (const fragment of sorted) {
    const matchingGroup = groups.findLast((group) =>
      sharesLine(group, fragment),
    );

    if (matchingGroup) {
      matchingGroup.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }

  return groups
    .map((group) => ({
      fragments: group,
      left: Math.min(...group.map((fragment) => fragment.bbox[0])),
      top: Math.min(...group.map((fragment) => fragment.bbox[1])),
      text: joinTextFragments(group),
    }))
    .filter((line) => line.text.length > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function fragmentTop(fragment: TextFragment): number {
  return fragment.bbox[1];
}

export function createReadablePageText(fragments: TextFragment[]): string {
  return groupTextFragments(fragments)
    .map((line) => line.text)
    .join("\n")
    .trim();
}
