/**
 * Shared diff computation utilities for the edit and similar tools.
 */

// XEON-PATCH: P13
// 원본의 `import * as Diff from "diff"`, `generateUnifiedPatch`, `generateDiffString`은 뺐다. 새 의존을 더하지 않고, diff 생성은 `src/files/diff.ts`가 한다.

// XEON-PATCH: P14
// XEON-PATCH: P15
import { Bug, err, ok, type Result } from "@xeon/contracts";

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

// XEON-PATCH: P18
/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      // Strip trailing whitespace per line
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // Smart single quotes → '
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      // Smart double quotes → "
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // Various dashes/hyphens → -
      // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
      // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      // Special spaces → regular space
      // U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
      // U+205F medium math space, U+3000 ideographic space
      .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
  );
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

interface LineSpan {
  start: number;
  end: number;
}

interface MatchedEdit {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

type TextReplacement = Pick<MatchedEdit, "matchIndex" | "matchLength" | "newText">;

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

// XEON-PATCH: P15
// XEON-PATCH: P17
/** 줄 번호로 줄을 얻는다. 범위 밖이면 호출한 쪽의 불변 조건이 깨진 것이다. */
function lineAt(lines: LineSpan[], index: number): LineSpan {
  const line = lines[index];
  if (line === undefined) {
    throw new Bug("Line index is outside the base content.");
  }
  return line;
}

function getReplacementLineRange(lines: LineSpan[], replacement: TextReplacement) {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;

  // XEON-PATCH: P17
  const startLine = lines.findIndex(
    (line) => replacementStart >= line.start && replacementStart < line.end,
  );
  // XEON-PATCH: P15
  if (startLine === -1) {
    throw new Bug("Replacement range is outside the base content.");
  }

  // XEON-PATCH: P17
  const endLine = lines.findIndex(
    (line, index) => index >= startLine && line.end >= replacementEnd,
  );
  // XEON-PATCH: P15
  if (endLine === -1) {
    throw new Bug("Replacement range is outside the base content.");
  }

  return { startLine, endLine: endLine + 1 };
}

// XEON-PATCH: P17
function applyReplacements(content: string, replacements: TextReplacement[], offset = 0): string {
  let result = content;
  for (const replacement of replacements.toReversed()) {
    const matchIndex = replacement.matchIndex - offset;
    result =
      result.substring(0, matchIndex) +
      replacement.newText +
      result.substring(matchIndex + replacement.matchLength);
  }
  return result;
}

// XEON-PATCH: P18
/**
 * Apply replacements matched against `baseContent` to `originalContent` while
 * preserving unchanged line blocks from the original.
 *
 * This is useful when `baseContent` is a normalized view of the original. Each
 * replacement is widened to the lines it actually touches, those touched lines
 * are rewritten from the normalized base, and all other lines are copied back
 * from `originalContent`. The actual replacement ranges drive preservation so
 * duplicate normalized lines cannot be aligned to the wrong occurrence.
 */
function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  // XEON-PATCH: P15
  if (originalLines.length !== baseLines.length) {
    throw new Bug(
      "Cannot preserve unchanged lines because the base content has a different line count.",
    );
  }

  const groups: Array<{ startLine: number; endLine: number; replacements: TextReplacement[] }> = [];
  // XEON-PATCH: P17
  const sortedReplacements = replacements.toSorted((a, b) => a.matchIndex - b.matchIndex);
  for (const replacement of sortedReplacements) {
    const range = getReplacementLineRange(baseLines, replacement);
    // XEON-PATCH: P17
    const current = groups.at(-1);
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }

  let originalLineIndex = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");

    // XEON-PATCH: P17
    const groupStartOffset = lineAt(baseLines, group.startLine).start;
    // XEON-PATCH: P17
    const groupEndOffset = lineAt(baseLines, group.endLine - 1).end;
    result += applyReplacements(
      baseContent.slice(groupStartOffset, groupEndOffset),
      group.replacements,
      groupStartOffset,
    );
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join("");

  return result;
}

// XEON-PATCH: P18
interface FuzzyMatchResult {
  /** Whether a match was found */
  found: boolean;
  /** The index where the match starts (in the content that should be used for replacement) */
  index: number;
  /** Length of the matched text */
  matchLength: number;
  /** Whether fuzzy matching was used (false = exact match) */
  usedFuzzyMatch: boolean;
  /**
   * The content to use for replacement operations.
   * When exact match: original content. When fuzzy match: normalized content.
   */
  contentForReplacement: string;
}

export interface Edit {
  oldText: string;
  newText: string;
}

// XEON-PATCH: P14
/** 적용 결과. `matchMode`는 모든 편집이 정확 일치로 찾아졌는지(`exact`) 퍼지 공간을 썼는지(`fuzzy`)다. */
export interface AppliedEdits {
  baseContent: string;
  newContent: string;
  matchMode: "exact" | "fuzzy";
}

// XEON-PATCH: P14
/**
 * 편집 실패 값. `kind`로 나눈다. 메시지 문구는 원본 오류 문구를 따르되 경로 조각은 뺐다(함수가 경로를 받지 않는다).
 * `editIndex`는 실패를 일으킨 편집의 번호다. `no_change`와 `overlap`은 각각 0과 앞 편집 번호를 쓴다.
 * `occurrences`는 `ambiguous`일 때, `fuzzyDisabled`는 설정이 꺼져 정확 일치만 본 `not_found`일 때만 있다.
 */
export type EditFailure = {
  readonly kind: "empty_old_text" | "not_found" | "ambiguous" | "overlap" | "no_change";
  readonly message: string;
  readonly editIndex: number;
  readonly totalEdits: number;
  readonly occurrences?: number;
  readonly fuzzyDisabled?: true;
};

// XEON-PATCH: P16
/**
 * Find oldText in content, trying exact match first, then fuzzy match.
 * When fuzzy matching is used, the returned contentForReplacement is the
 * fuzzy-normalized version of the content (trailing whitespace stripped,
 * Unicode quotes/dashes normalized to ASCII).
 */
function fuzzyFindText(content: string, oldText: string, fuzzy: boolean): FuzzyMatchResult {
  // Try exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // XEON-PATCH: P16
  // E17: 설정이 꺼지면 퍼지 공간을 만들지 않고 정확 일치 실패로 끝낸다
  if (!fuzzy) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // Try fuzzy match - work entirely in normalized space
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // When fuzzy matching, return offsets in normalized space. Callers can use
  // the normalized content to compute replacements, then decide how much of
  // that normalized output should be written back.
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

// XEON-PATCH: P16
function countOccurrences(content: string, oldText: string, fuzzy: boolean): number {
  // XEON-PATCH: P16
  // E17: 정확 일치만 쓸 때는 정확 공간에서 세야 찾은 자리와 같은 공간이다
  if (!fuzzy) {
    return content.split(oldText).length - 1;
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

// XEON-PATCH: P14
function emptyOldTextFailure(editIndex: number, totalEdits: number): EditFailure {
  return {
    kind: "empty_old_text",
    message:
      totalEdits === 1
        ? "oldText must not be empty."
        : `edits[${editIndex}].oldText must not be empty.`,
    editIndex,
    totalEdits,
  };
}

// XEON-PATCH: P14
function notFoundFailure(
  editIndex: number,
  totalEdits: number,
  fuzzyDisabled: boolean,
): EditFailure {
  const message =
    totalEdits === 1
      ? "Could not find the exact text. The old text must match exactly including all whitespace and newlines."
      : `Could not find edits[${editIndex}]. The oldText must match exactly including all whitespace and newlines.`;
  if (fuzzyDisabled) {
    return { kind: "not_found", message, editIndex, totalEdits, fuzzyDisabled: true };
  }
  return { kind: "not_found", message, editIndex, totalEdits };
}

// XEON-PATCH: P14
function ambiguousFailure(editIndex: number, totalEdits: number, occurrences: number): EditFailure {
  const message =
    totalEdits === 1
      ? `Found ${occurrences} occurrences of the text. The text must be unique. Please provide more context to make it unique.`
      : `Found ${occurrences} occurrences of edits[${editIndex}]. Each oldText must be unique. Please provide more context to make it unique.`;
  return { kind: "ambiguous", message, editIndex, totalEdits, occurrences };
}

// XEON-PATCH: P14
function overlapFailure(earlier: number, later: number, totalEdits: number): EditFailure {
  return {
    kind: "overlap",
    message: `edits[${earlier}] and edits[${later}] overlap. Merge them into one edit or target disjoint regions.`,
    editIndex: earlier,
    totalEdits,
  };
}

// XEON-PATCH: P14
function noChangeFailure(totalEdits: number): EditFailure {
  return {
    kind: "no_change",
    message:
      totalEdits === 1
        ? "No changes made. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected."
        : "No changes made. The replacements produced identical content.",
    editIndex: 0,
    totalEdits,
  };
}

// XEON-PATCH: P14
/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the same original content. Replacements are
 * then applied in reverse order so offsets remain stable. If any edit needs
 * fuzzy matching, the operation runs in fuzzy-normalized content space and then
 * overlays those line-level changes onto the original content so unchanged line
 * blocks keep their original bytes.
 *
 * 원본 `applyEditsToNormalizedContent`를 대신한다. 실패는 던지지 않고 `EditFailure` 값으로 돌려준다.
 * `content`는 호출한 쪽이 BOM을 떼고 LF로 맞춘 본문이다. `fuzzy: false`면 퍼지 공간을 쓰지 않는다(E17).
 */
export function applyEdits(
  content: string,
  edits: readonly Edit[],
  options: { readonly fuzzy: boolean },
): Result<AppliedEdits, EditFailure> {
  const { fuzzy } = options;
  const totalEdits = edits.length;
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  for (const [editIndex, edit] of normalizedEdits.entries()) {
    if (edit.oldText.length === 0) {
      return err(emptyOldTextFailure(editIndex, totalEdits));
    }
  }

  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(content, edit.oldText, fuzzy));
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
  const replacementBaseContent = usedFuzzyMatch ? normalizeForFuzzyMatch(content) : content;

  const matchedEdits: MatchedEdit[] = [];
  for (const [editIndex, edit] of normalizedEdits.entries()) {
    const matchResult = fuzzyFindText(replacementBaseContent, edit.oldText, fuzzy);
    if (!matchResult.found) {
      return err(notFoundFailure(editIndex, totalEdits, !fuzzy));
    }

    const occurrences = countOccurrences(replacementBaseContent, edit.oldText, fuzzy);
    if (occurrences > 1) {
      return err(ambiguousFailure(editIndex, totalEdits, occurrences));
    }

    matchedEdits.push({
      editIndex,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    });
  }

  // XEON-PATCH: P17
  const sortedEdits = matchedEdits.toSorted((a, b) => a.matchIndex - b.matchIndex);
  for (const [index, previous] of sortedEdits.entries()) {
    const current = sortedEdits[index + 1];
    if (current !== undefined && previous.matchIndex + previous.matchLength > current.matchIndex) {
      return err(overlapFailure(previous.editIndex, current.editIndex, totalEdits));
    }
  }

  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(content, replacementBaseContent, sortedEdits)
    : applyReplacements(replacementBaseContent, sortedEdits);

  if (content === newContent) {
    return err(noChangeFailure(totalEdits));
  }

  const applied: AppliedEdits = {
    baseContent: content,
    newContent,
    matchMode: usedFuzzyMatch ? "fuzzy" : "exact",
  };
  return ok(applied);
}
