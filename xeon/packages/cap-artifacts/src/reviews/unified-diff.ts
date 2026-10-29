import { err, ok, type Result } from "@xeon/contracts";
import { sha256Hex } from "../hash.ts";
import type {
  DiffFile,
  DiffHunk,
  DiffParseError,
  FileChangeKind,
  ReviewFile,
  ReviewHunk,
  ReviewTooLarge,
} from "./types.ts";

// L2.artifacts.spec §4.2.2. 통합 diff 텍스트를 DiffFile로 해석하고, 리뷰용으로 정규화한다(파일 정렬, hunk ID, 해시, 상한).
// 해석은 cap-workspace의 buildFileChange가 쓰는 모양(`--- a/…`, `+++ b/…`, `@@ -a,b +c,d @@`)과 git 출력의 확장 헤더
// (`diff --git`, `index`, 모드, `rename from/to`, `Binary files … differ`)를 받는다.
// 본문은 헤더의 줄 수로 끝을 정한다. 그래서 지운 줄 `-- x`가 `--- x`로 보여도 파일 헤더로 오인하지 않는다.

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BINARY_LINE = /^Binary files (.+) and (.+) differ$/;
const RENAME_FROM = "rename from ";
const RENAME_TO = "rename to ";
const EXTENDED_PREFIXES: readonly string[] = [
  "index ",
  "old mode ",
  "new mode ",
  "new file mode ",
  "deleted file mode ",
  "similarity index ",
  "dissimilarity index ",
  RENAME_FROM,
  RENAME_TO,
];
const ENCODER = new TextEncoder();

interface FileShape {
  readonly path: string;
  readonly oldPath: string | null;
  readonly change: FileChangeKind;
}

interface BlockRead {
  readonly file: DiffFile;
  readonly next: number;
}

interface HunkRead {
  readonly hunk: DiffHunk;
  readonly next: number;
}

/** 1부터 세는 줄 번호로 해석 실패를 만든다 */
function fail(line: number): Result<never, DiffParseError> {
  const error: DiffParseError = { kind: "diff_unparsable", line };
  return err(error);
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function isExtendedHeader(line: string): boolean {
  return EXTENDED_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** `---`·`+++`·`Binary files`의 한쪽 경로. `/dev/null`이면 null, 줄이 없거나 접두가 틀리면 undefined */
function sidePath(text: string | undefined, prefix: "a/" | "b/"): string | null | undefined {
  if (text === undefined) return undefined;
  if (text === "/dev/null") return null;
  if (!text.startsWith(prefix) || text.length === prefix.length) return undefined;
  return text.slice(prefix.length);
}

/** 양쪽 경로로 파일의 경로·원래 경로·변경 종류를 정한다. 양쪽 모두 /dev/null이면 undefined */
function shapeOf(
  oldSide: string | null,
  newSide: string | null,
  renamed: boolean,
): FileShape | undefined {
  if (newSide === null) {
    return oldSide === null ? undefined : { path: oldSide, oldPath: oldSide, change: "deleted" };
  }
  if (oldSide === null) return { path: newSide, oldPath: null, change: "added" };
  const change: FileChangeKind = renamed || oldSide !== newSide ? "renamed" : "modified";
  return { path: newSide, oldPath: oldSide, change };
}

/** `\ No newline at end of file` 줄을 본문에 넣고, 그 다음 줄 번호를 돌려준다 */
function takeMarkers(lines: readonly string[], index: number, body: string[]): number {
  let i = index;
  let line = lines[i];
  while (line !== undefined && line.startsWith("\\")) {
    body.push(line);
    i++;
    line = lines[i];
  }
  return i;
}

/** 본문이 끝난 뒤의 줄이 본문처럼 보이면 참이다(`--- `는 다음 파일 헤더다) */
function isBodyLikeAfterHunk(line: string): boolean {
  if (line.startsWith("--- ")) return false;
  return line.startsWith(" ") || line.startsWith("+") || line.startsWith("-");
}

/** `start` 줄의 `@@` 헤더와 그 본문을 읽는다. 본문 줄 수가 헤더와 맞지 않으면 헤더 줄을 가리킨 실패다 */
function readHunk(lines: readonly string[], start: number): Result<HunkRead, DiffParseError> {
  const header = lines[start];
  const match = header === undefined ? null : HUNK_HEADER.exec(header);
  if (header === undefined || match === null) return fail(start + 1);

  const oldLines = match[2] === undefined ? 1 : Number(match[2]);
  const newLines = match[4] === undefined ? 1 : Number(match[4]);
  const body: string[] = [];
  let remainingOld = oldLines;
  let remainingNew = newLines;
  let i = start + 1;
  while (remainingOld > 0 || remainingNew > 0) {
    const line = lines[i];
    if (line === undefined) return fail(start + 1);
    const kind = line.charAt(0);
    const takesOld = kind === " " || kind === "-";
    const takesNew = kind === " " || kind === "+";
    if (!takesOld && !takesNew) return fail(start + 1);
    if ((takesOld && remainingOld === 0) || (takesNew && remainingNew === 0)) {
      return fail(start + 1);
    }
    if (takesOld) remainingOld--;
    if (takesNew) remainingNew--;
    body.push(line);
    i = takeMarkers(lines, i + 1, body);
  }

  // 헤더가 말한 줄 수를 다 채웠는데 본문이 이어지면 줄 수가 틀린 것이다
  const after = lines[i];
  if (after !== undefined && isBodyLikeAfterHunk(after)) return fail(start + 1);

  return ok({
    hunk: {
      header,
      oldStart: Number(match[1]),
      oldLines,
      newStart: Number(match[3]),
      newLines,
      lines: body,
    },
    next: i,
  });
}

/** `start` 줄에서 시작하는 파일 블록 하나를 읽는다 */
function readBlock(lines: readonly string[], start: number): Result<BlockRead, DiffParseError> {
  const startLine = start + 1;
  let i = start;
  if (lines[i]?.startsWith("diff --git ") === true) i++;

  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let line = lines[i];
  while (line !== undefined && isExtendedHeader(line)) {
    if (line.startsWith(RENAME_FROM)) {
      renameFrom = line.slice(RENAME_FROM.length);
    } else if (line.startsWith(RENAME_TO)) {
      renameTo = line.slice(RENAME_TO.length);
    }
    i++;
    line = lines[i];
  }
  if (
    (renameFrom === undefined) !== (renameTo === undefined) ||
    renameFrom === "" ||
    renameTo === ""
  ) {
    return fail(startLine);
  }
  const rename =
    renameFrom !== undefined && renameTo !== undefined
      ? { from: renameFrom, to: renameTo }
      : undefined;

  if (line !== undefined && line.startsWith("Binary files ")) {
    const match = BINARY_LINE.exec(line);
    const oldSide = sidePath(match?.[1], "a/");
    const newSide = sidePath(match?.[2], "b/");
    const shape =
      oldSide === undefined || newSide === undefined
        ? undefined
        : shapeOf(oldSide, newSide, rename !== undefined);
    if (shape === undefined) return fail(i + 1);
    return ok({ file: { ...shape, binary: true, hunks: [] }, next: i + 1 });
  }

  if (line !== undefined && line.startsWith("--- ")) {
    const oldSide = sidePath(line.slice(4), "a/");
    const plus = lines[i + 1];
    if (oldSide === undefined || plus === undefined || !plus.startsWith("+++ ")) {
      return fail(i + 1);
    }
    const newSide = sidePath(plus.slice(4), "b/");
    if (newSide === undefined) return fail(i + 2);
    i += 2;

    const hunks: DiffHunk[] = [];
    let header = lines[i];
    while (header !== undefined && header.startsWith("@@")) {
      const read = readHunk(lines, i);
      if (!read.ok) return read;
      hunks.push(read.value.hunk);
      i = read.value.next;
      header = lines[i];
    }
    const shape = shapeOf(oldSide, newSide, rename !== undefined);
    if (shape === undefined) return fail(startLine);
    return ok({ file: { ...shape, binary: false, hunks }, next: i });
  }

  // 본문 없이 rename 줄만 있는 블록(git의 100% 이동)
  if (rename !== undefined) {
    const shape = shapeOf(rename.from, rename.to, true);
    if (shape === undefined) return fail(startLine);
    return ok({ file: { ...shape, binary: false, hunks: [] }, next: i });
  }

  return fail(startLine);
}

/** 통합 diff 텍스트를 파일 블록 목록으로 해석한다. 파일 블록이 하나도 없으면 실패다 */
export function parseUnifiedDiff(text: string): Result<DiffFile[], DiffParseError> {
  const lines = splitLines(text);
  const files: DiffFile[] = [];
  let next = 0;
  while (next < lines.length) {
    const block = readBlock(lines, next);
    if (!block.ok) return block;
    files.push(block.value.file);
    next = block.value.next;
  }
  if (files.length === 0) return fail(1);
  return ok(files);
}

/** 같은 경로의 파일 블록을 입력 순서대로 hunk를 이어 하나로 합친다. 첫 블록의 oldPath·change·binary가 이긴다 */
export function mergeDiffFiles(files: readonly DiffFile[]): DiffFile[] {
  const merged = new Map<string, DiffFile>();
  for (const file of files) {
    const first = merged.get(file.path);
    merged.set(
      file.path,
      first === undefined ? file : { ...first, hunks: [...first.hunks, ...file.hunks] },
    );
  }
  return [...merged.values()];
}

/** UTF-8 바이트 순서로 비교한다. UTF-16 코드 단위 순서와 다르다(U+FFFD와 U+1F600이 그렇다) */
function compareUtf8(a: string, b: string): number {
  const x = ENCODER.encode(a);
  const y = ENCODER.encode(b);
  const common = Math.min(x.length, y.length);
  for (let i = 0; i < common; i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

/**
 * 리뷰용으로 정규화한다. 파일은 경로의 UTF-8 바이트 순으로 정렬해 0부터 번호를 붙이고, hunk ID는 파일 안의
 * 입력 순서로 `f<파일>h<hunk>`를 붙인다. 상한을 넘으면 실패다.
 */
export function normalizeReview(
  files: readonly DiffFile[],
  limits: { readonly maxFiles: number; readonly maxHunks: number } = {
    maxFiles: 256,
    maxHunks: 4096,
  },
): Result<ReviewFile[], ReviewTooLarge> {
  const hunkCount = files.reduce((total, file) => total + file.hunks.length, 0);
  if (files.length > limits.maxFiles || hunkCount > limits.maxHunks) {
    const error: ReviewTooLarge = { kind: "review_too_large" };
    return err(error);
  }

  const sorted = files.toSorted((a, b) => compareUtf8(a.path, b.path));
  const reviewFiles: ReviewFile[] = sorted.map((file, fileIndex) => ({
    fileIndex,
    path: file.path,
    oldPath: file.oldPath,
    change: file.change,
    binary: file.binary,
    hunks: file.hunks.map((hunk, hunkIndex): ReviewHunk => ({
      ...hunk,
      hunkId: `f${fileIndex}h${hunkIndex}`,
      patchSha256: sha256Hex(`${hunk.header}\n${hunk.lines.join("\n")}`),
    })),
  }));
  return ok(reviewFiles);
}

/** `---` 줄의 경로. 원래 경로가 있으면 그것을 쓰고, 없으면 추가한 파일은 /dev/null, 그 밖에는 새 경로를 쓴다 */
function oldName(file: ReviewFile): string {
  if (file.oldPath !== null) return `a/${file.oldPath}`;
  return file.change === "added" ? "/dev/null" : `a/${file.path}`;
}

function newName(file: ReviewFile): string {
  return file.change === "deleted" ? "/dev/null" : `b/${file.path}`;
}

/** 정규화한 파일을 통합 diff 텍스트로 쓴다. `parseUnifiedDiff`로 되읽을 수 있는 모양이다 */
export function renderReviewDiff(files: readonly ReviewFile[]): string {
  let text = "";
  for (const file of files) {
    if (file.change === "renamed") {
      // 이동한 파일은 rename 줄로 원래 경로를 먼저 밝힌다. 해석은 rename 줄이 있으면 renamed로 본다
      text += `rename from ${file.oldPath ?? file.path}\nrename to ${file.path}\n`;
    }
    if (file.binary) {
      text += `Binary files ${oldName(file)} and ${newName(file)} differ\n`;
      continue;
    }
    text += `--- ${oldName(file)}\n+++ ${newName(file)}\n`;
    for (const hunk of file.hunks) {
      text += `${hunk.header}\n`;
      for (const line of hunk.lines) {
        text += `${line}\n`;
      }
    }
  }
  return text;
}

function dropNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * hunk의 옛 쪽 글(문맥과 지운 줄)과 새 쪽 글(문맥과 추가한 줄)을 만든다. 각 줄은 `\n`으로 끝나고, 줄 끝 없음 표시는
 * 바로 앞 줄의 `\n`을 뗀다. 문맥 줄 뒤면 양쪽, 지운 줄 뒤면 옛 쪽, 추가한 줄 뒤면 새 쪽이다.
 */
export function hunkSides(hunk: DiffHunk): { oldText: string; newText: string } {
  let oldText = "";
  let newText = "";
  let previous: string | undefined;
  for (const line of hunk.lines) {
    const kind = line.charAt(0);
    if (kind === "\\") {
      if (previous === " ") {
        oldText = dropNewline(oldText);
        newText = dropNewline(newText);
      } else if (previous === "-") {
        oldText = dropNewline(oldText);
      } else if (previous === "+") {
        newText = dropNewline(newText);
      }
      continue;
    }
    const body = `${line.slice(1)}\n`;
    if (kind === " ") {
      oldText += body;
      newText += body;
    } else if (kind === "-") {
      oldText += body;
    } else if (kind === "+") {
      newText += body;
    }
    previous = kind;
  }
  return { oldText, newText };
}
