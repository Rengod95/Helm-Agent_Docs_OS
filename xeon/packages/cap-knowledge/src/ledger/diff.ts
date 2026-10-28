// L2.knowledge.spec §3.5 show용 통합 diff. 순수 함수다. 작은 입력용 LCS이고 큰 입력은 생략한다.

/** 앞뒤 공통 줄을 뺀 뒤 DP 표 크기 상한(셀 수) */
const MAX_DP_CELLS = 4_000_000;
const CONTEXT = 3;

type Op = { readonly sign: " " | "-" | "+"; readonly line: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function editScript(before: readonly string[], after: readonly string[]): Op[] | undefined {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if ((a.length + 1) * (b.length + 1) > MAX_DP_CELLS) return undefined;

  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = before.slice(0, start).map((line) => ({ sign: " ", line }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ sign: " ", line: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ sign: "-", line: a[i] ?? "" });
      i += 1;
    } else {
      ops.push({ sign: "+", line: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ sign: "-", line: a[i] ?? "" });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ sign: "+", line: b[j] ?? "" });
    j += 1;
  }
  for (const line of before.slice(endBefore)) ops.push({ sign: " ", line });
  return ops;
}

/** `--- a/<path>`, `+++ b/<path>` 머리와 문맥 3줄 조각으로 만든 통합 diff. 같으면 빈 문자열 */
export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const ops = editScript(splitLines(before), splitLines(after));
  if (ops === undefined) return `--- a/${path}\n+++ b/${path}\n(diff omitted: file is too large)\n`;

  const changed = ops.flatMap((op, index) => (op.sign === " " ? [] : [index]));
  const hunks: { from: number; to: number }[] = [];
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(ops.length, index + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
    else hunks.push({ from, to });
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    const slice = ops.slice(hunk.from, hunk.to);
    const beforeStart = ops.slice(0, hunk.from).filter((op) => op.sign !== "+").length + 1;
    const afterStart = ops.slice(0, hunk.from).filter((op) => op.sign !== "-").length + 1;
    const beforeCount = slice.filter((op) => op.sign !== "+").length;
    const afterCount = slice.filter((op) => op.sign !== "-").length;
    out.push(`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`);
    for (const op of slice) out.push(`${op.sign}${op.line}`);
  }
  return `${out.join("\n")}\n`;
}
