import { compareBytes, utf8DecodeStrict } from "../hash.ts";
import { unifiedDiff } from "../ledger/diff.ts";
import type { Tree } from "../skills/tree.ts";

// L2.knowledge.spec §4.5.1 승인 요청과 §4.5.2 제안 대기열의 미리보기. 현재 내용(before)에서 새 내용(after)으로 가는 통합 diff를
// 파일마다 이어 붙인다. 순수 함수다. 글자 수에서 자른다(승인 요청은 20,000자).

const PREVIEW_MAX_CHARS = 20_000;
const TRUNCATED = "\n(preview truncated)\n";

export function previewDiff(before: Tree | null, after: Tree | null): string {
  const beforeByPath = new Map(before?.files.map((file) => [file.path, file.bytes]));
  const afterByPath = new Map(after?.files.map((file) => [file.path, file.bytes]));
  const paths = Array.from(new Set([...beforeByPath.keys(), ...afterByPath.keys()])).toSorted(
    compareBytes,
  );
  const parts: string[] = [];
  for (const path of paths) {
    const old = beforeByPath.get(path);
    const now = afterByPath.get(path);
    if (old !== undefined && now !== undefined && Buffer.compare(old, now) === 0) continue;
    const oldText = old === undefined ? "" : utf8DecodeStrict(old);
    const newText = now === undefined ? "" : utf8DecodeStrict(now);
    if (oldText === undefined || newText === undefined) {
      parts.push(
        `Binary file ${path} changed (${String(old?.byteLength ?? 0)} -> ${String(now?.byteLength ?? 0)} bytes)\n`,
      );
      continue;
    }
    parts.push(unifiedDiff(path, oldText, newText));
  }
  const joined = parts.join("\n");
  if (joined.length <= PREVIEW_MAX_CHARS) return joined;
  return `${joined.slice(0, PREVIEW_MAX_CHARS - TRUNCATED.length)}${TRUNCATED}`;
}
