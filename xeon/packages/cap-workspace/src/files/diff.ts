import { Bug } from "@xeon/contracts";
import type { FileChange } from "@xeon/contracts/capabilities";

// L2.workspace.spec §4.4. `FileChange.diff`는 외부 라이브러리 없이 이 파일이 만든다(통합 diff, 문맥 3줄).
// 줄 단위 LCS로 차이를 구하고, 앞뒤 공통 줄은 먼저 떼어 낸다. 가운데 구간의 칸 수가 MAX_LCS_CELLS를 넘으면
// 가운데 전체를 삭제 한 덩어리와 추가 한 덩어리로 본다.

/** 변경 앞뒤로 보여 주는 문맥 줄 수 */
const CONTEXT_LINES = 3;
/** 가운데 구간의 LCS 칸 수 상한(삭제 줄 수 × 추가 줄 수). 넘으면 LCS 표를 만들지 않는다 */
const MAX_LCS_CELLS = 4_000_000;

type OpKind = "equal" | "remove" | "add";

/** 줄 하나. 토큰은 줄바꿈까지 포함하고, 줄바꿈 없이 끝나는 마지막 줄은 줄바꿈 없이 둔다 */
interface Entry {
  readonly kind: OpKind;
  readonly token: string;
}

/** 편집 순서의 줄. `oldBefore`·`newBefore`는 이 줄 앞에 있는 이전·새 파일의 줄 수다 */
interface Op extends Entry {
  readonly oldBefore: number;
  readonly newBefore: number;
}

const MARK: Readonly<Record<OpKind, string>> = { equal: " ", remove: "-", add: "+" };

function toTokens(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function required<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Bug("Index is outside the diff input.");
  }
  return item;
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length);
  let count = 0;
  while (count < limit && a[count] === b[count]) count++;
  return count;
}

function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix;
  let count = 0;
  while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
}

/** 가운데 구간의 편집. 칸 수가 상한을 넘으면 LCS를 만들지 않고 삭제 한 덩어리 뒤에 추가 한 덩어리를 낸다 */
function middleEntries(oldMiddle: readonly string[], newMiddle: readonly string[]): Entry[] {
  if (oldMiddle.length * newMiddle.length > MAX_LCS_CELLS) {
    return [
      ...oldMiddle.map((token): Entry => ({ kind: "remove", token })),
      ...newMiddle.map((token): Entry => ({ kind: "add", token })),
    ];
  }
  return lcsEntries(oldMiddle, newMiddle);
}

function lcsEntries(a: readonly string[], b: readonly string[]): Entry[] {
  // table[i * width + j]: a[i..]와 b[j..]의 최장 공통 부분열 길이
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const lcs = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const entries: Entry[] = [];
  // 같은 변경 덩어리 안에서는 삭제 줄을 먼저, 추가 줄을 나중에 낸다
  const removed: string[] = [];
  const added: string[] = [];
  const flush = (): void => {
    for (const token of removed) entries.push({ kind: "remove", token });
    for (const token of added) entries.push({ kind: "add", token });
    removed.length = 0;
    added.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      entries.push({ kind: "equal", token: required(a, i) });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs(i + 1, j) >= lcs(i, j + 1))) {
      removed.push(required(a, i));
      i++;
    } else {
      added.push(required(b, j));
      j++;
    }
  }
  flush();
  return entries;
}

function diffEntries(oldTokens: readonly string[], newTokens: readonly string[]): Entry[] {
  const prefix = commonPrefix(oldTokens, newTokens);
  const suffix = commonSuffix(oldTokens, newTokens, prefix);
  const oldEnd = oldTokens.length - suffix;
  const newEnd = newTokens.length - suffix;

  const entries: Entry[] = [];
  for (const token of oldTokens.slice(0, prefix)) entries.push({ kind: "equal", token });
  for (const entry of middleEntries(
    oldTokens.slice(prefix, oldEnd),
    newTokens.slice(prefix, newEnd),
  )) {
    entries.push(entry);
  }
  for (const token of oldTokens.slice(oldEnd)) entries.push({ kind: "equal", token });
  return entries;
}

function withPositions(entries: readonly Entry[]): Op[] {
  const ops: Op[] = [];
  let oldBefore = 0;
  let newBefore = 0;
  for (const entry of entries) {
    ops.push({ ...entry, oldBefore, newBefore });
    if (entry.kind !== "add") oldBefore++;
    if (entry.kind !== "remove") newBefore++;
  }
  return ops;
}

/** 변경 줄에 문맥을 붙인 구간 [시작, 끝). 문맥이 겹치거나 맞닿는 변경은 한 구간이다 */
function hunkRanges(ops: readonly Op[]): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let first = -1;
  let last = -1;
  for (const [index, op] of ops.entries()) {
    if (op.kind === "equal") continue;
    // 사이에 낀 같은 줄 수가 2 × 문맥보다 많으면 문맥이 맞닿지 않으므로 새 구간을 연다
    if (first !== -1 && index - last - 1 > 2 * CONTEXT_LINES) {
      ranges.push(windowOf(ops.length, first, last));
      first = -1;
    }
    if (first === -1) first = index;
    last = index;
  }
  if (first !== -1) ranges.push(windowOf(ops.length, first, last));
  return ranges;
}

function windowOf(total: number, first: number, last: number): readonly [number, number] {
  return [Math.max(0, first - CONTEXT_LINES), Math.min(total, last + CONTEXT_LINES + 1)];
}

/** 줄 범위 표기. 한 줄이면 `,1`을 생략하고 0줄이면 `,0`을 쓴다(통합 diff 관례) */
function rangeText(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function bodyOf(token: string): string {
  return token.endsWith("\n") ? token.slice(0, -1) : token;
}

function renderHunk(ops: readonly Op[], start: number, end: number): string {
  const hunk = ops.slice(start, end);
  const first = required(ops, start);
  const oldCount = hunk.filter((op) => op.kind !== "add").length;
  const newCount = hunk.filter((op) => op.kind !== "remove").length;
  // 줄이 없는 쪽의 시작 줄은 그 앞 줄 번호다(예: 새 파일은 -0,0)
  const oldStart = oldCount === 0 ? first.oldBefore : first.oldBefore + 1;
  const newStart = newCount === 0 ? first.newBefore : first.newBefore + 1;

  let text = `@@ -${rangeText(oldStart, oldCount)} +${rangeText(newStart, newCount)} @@\n`;
  for (const op of hunk) {
    text += `${MARK[op.kind]}${bodyOf(op.token)}\n`;
    if (!op.token.endsWith("\n")) text += "\\ No newline at end of file\n";
  }
  return text;
}

function renderDiff(ops: readonly Op[], relativePath: string, existed: boolean): string {
  const ranges = hunkRanges(ops);
  if (ranges.length === 0) return "";
  const oldName = existed ? `a/${relativePath}` : "/dev/null";
  let text = `--- ${oldName}\n+++ b/${relativePath}\n`;
  for (const [start, end] of ranges) {
    text += renderHunk(ops, start, end);
  }
  return text;
}

/**
 * 쓰기·편집 결과의 `FileChange`를 만든다. `firstChangedLine`은 새 파일 기준 처음 바뀐 줄(1부터)이다.
 * 추가 줄은 그 줄 번호이고, 삭제만 있으면 삭제가 일어난 자리 바로 뒤 줄 번호(파일 끝이면 줄 수 + 1)다.
 * 바뀐 줄이 없으면 `diff`는 빈 문자열이고 `firstChangedLine` 키가 없다.
 */
export function buildFileChange(input: {
  readonly path: string;
  readonly relativePath: string;
  readonly existed: boolean;
  readonly before: string;
  readonly after: string;
}): FileChange {
  const ops = withPositions(diffEntries(toTokens(input.before), toTokens(input.after)));
  const changes = ops.filter((op) => op.kind !== "equal");
  const added = changes.filter((op) => op.kind === "add").length;
  const first = changes[0];
  return {
    path: input.path,
    existed: input.existed,
    diff: renderDiff(ops, input.relativePath, input.existed),
    added,
    removed: changes.length - added,
    ...(first === undefined ? {} : { firstChangedLine: first.newBefore + 1 }),
  };
}
