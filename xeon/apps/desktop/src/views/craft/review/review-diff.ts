import type { FileChangeRow } from "../../approval-form.ts";

// 갱신 항목의 파일 전·후를 줄 단위 차이로(craft-flows 6.12, 엔진 `pluginReview.file`의 `side: "base"`).
// Myers 차이(O((N+M)·D))로 가장 짧은 편집을 찾고, 바뀐 곳 둘레에 같은 줄 3개만 남겨 덩이로 묶는다. 그리기는 기존 차이 부품
// (`file-change-view.tsx`의 `FileChangeDiff`, edit 그림)이 한다. React 밖에서 시험한다(test/views/craft/review-diff.test.ts).

/** 바뀐 곳 앞뒤에 남기는 같은 줄 수 */
const CONTEXT = 3;
/** 편집 거리 상한. 넘으면(거의 다 바뀐 파일) 공통 머리·꼬리만 떼고 나머지를 통째로 지움 + 더함으로 본다 */
const MAX_EDITS = 600;

/** 차이 줄 하나. `number`는 지운 줄이면 지난 판의 줄 번호, 그 밖에는 새 판의 줄 번호다(caustic `CodeDiffLine`의 규칙) */
export interface DiffRow extends FileChangeRow {
  readonly number: number;
}

/** 덩이 하나. `skipped`는 이 덩이 앞에서 접어 둔 같은 줄 수다 */
export interface DiffHunk {
  readonly skipped: number;
  readonly rows: readonly DiffRow[];
}

export interface LineDiff {
  readonly hunks: readonly DiffHunk[];
  /** 마지막 덩이 뒤에서 접어 둔 같은 줄 수 */
  readonly trailing: number;
  readonly added: number;
  readonly removed: number;
}

/** 새 파일·지운 파일처럼 한쪽만 있는 글을 차이 줄로(모두 더함 또는 모두 지움) */
export function wholeFileRows(
  text: string,
  kind: "add" | "remove" | "context",
): readonly DiffRow[] {
  return linesOf(text).map((line, index) => ({ kind, text: line, number: index + 1 }));
}

/** 글을 줄로 나눈다. 빈 글은 줄이 없고, 끝의 줄바꿈 하나는 줄을 늘리지 않는다 */
export function linesOf(text: string): readonly string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

type Op = FileChangeRow["kind"];

/** 되짚기용으로 남긴 `v` 구간(k = -d-1 … d+1)에서 k의 값 */
function traceAt(row: Int32Array, d: number, k: number): number {
  return row[k + d + 1] ?? 0;
}

/**
 * 가장 짧은 편집 순서(같음·지움·더함). 편집이 `limit`를 넘으면 null이다.
 * 매 단계 앞의 `v` 가운데 쓰는 구간(k = -d-1 … d+1)만 남겨 되짚는다(메모리는 편집 수의 제곱에 비례)
 */
function shortestEdit(a: readonly string[], b: readonly string[], limit: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, limit); d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        // 되짚기: 끝에서 처음으로 가며 같은 줄(대각선)과 편집 한 칸을 모은다
        const ops: Op[] = [];
        let cx = n;
        let cy = m;
        for (let step = trace.length - 1; step >= 0; step -= 1) {
          const row = trace[step];
          if (row === undefined) break;
          const ck = cx - cy;
          const prevDown =
            ck === -step ||
            (ck !== step && traceAt(row, step, ck - 1) < traceAt(row, step, ck + 1));
          const prevK = prevDown ? ck + 1 : ck - 1;
          const prevX = traceAt(row, step, prevK);
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            ops.push("context");
            cx -= 1;
            cy -= 1;
          }
          if (step > 0) ops.push(cx === prevX ? "add" : "remove");
          cx = prevX;
          cy = prevY;
        }
        return ops.toReversed();
      }
    }
  }
  return null;
}

/** 공통 머리·꼬리를 떼고 가운데만 차이를 낸다. 가운데가 너무 다르면 통째로 지움 + 더함이다 */
function opsOf(a: readonly string[], b: readonly string[]): Op[] {
  const limit = Math.min(a.length, b.length);
  let head = 0;
  while (head < limit && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < limit - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const mid = shortestEdit(midA, midB, MAX_EDITS) ?? [
    ...midA.map((): Op => "remove"),
    ...midB.map((): Op => "add"),
  ];
  return [
    ...Array.from({ length: head }, (): Op => "context"),
    ...mid,
    ...Array.from({ length: tail }, (): Op => "context"),
  ];
}

/** 지난 판과 새 판의 줄 차이. 같은 글이면 덩이가 없다 */
export function lineDiffOf(before: string, after: string): LineDiff {
  const a = linesOf(before);
  const b = linesOf(after);
  const ops = opsOf(a, b);
  // 편집 순서에 줄 글을 붙인다(같음·지움은 a에서, 더함은 b에서)
  const rows: DiffRow[] = [];
  let ia = 0;
  let ib = 0;
  for (const op of ops) {
    if (op === "add") {
      rows.push({ kind: "add", text: b[ib] ?? "", number: ib + 1 });
      ib += 1;
    } else if (op === "remove") {
      rows.push({ kind: "remove", text: a[ia] ?? "", number: ia + 1 });
      ia += 1;
    } else {
      rows.push({ kind: "context", text: a[ia] ?? "", number: ib + 1 });
      ia += 1;
      ib += 1;
    }
  }
  // 바뀐 줄마다 앞뒤 CONTEXT줄을 보일 줄로 표시하고, 이어진 보일 줄을 덩이로 묶는다
  const keep = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    for (
      let i = Math.max(0, index - CONTEXT);
      i <= Math.min(rows.length - 1, index + CONTEXT);
      i += 1
    ) {
      keep[i] = true;
    }
  });
  const hunks: { skipped: number; rows: DiffRow[] }[] = [];
  let skipped = 0;
  let open = false;
  for (const [index, row] of rows.entries()) {
    if (keep[index] !== true) {
      open = false;
      skipped += 1;
      continue;
    }
    const last = hunks[hunks.length - 1];
    if (open && last !== undefined) {
      last.rows.push(row);
    } else {
      hunks.push({ skipped, rows: [row] });
      skipped = 0;
      open = true;
    }
  }
  return {
    hunks,
    trailing: skipped,
    added: rows.filter((row) => row.kind === "add").length,
    removed: rows.filter((row) => row.kind === "remove").length,
  };
}

/** 접힌 줄을 내어 쓸 폭(ch). 줄 앞의 공백과 탭(4칸)을 센다. 아주 깊은 들여쓰기는 32칸에서 멈춘다(넘어간 줄이 너무 좁아지지 않게) */
export const MAX_HANG = 32;

export function indentOf(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return Math.min(width, MAX_HANG);
}
