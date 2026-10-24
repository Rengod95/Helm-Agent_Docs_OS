import { err, ok, type Result } from "@xeon/contracts";
import type { LedgerShowOutput } from "@xeon/contracts/capabilities";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { compareBytes, utf8DecodeStrict } from "../hash.ts";
import type { Tree } from "../skills/tree.ts";
import type { LedgerDeps } from "./change.ts";
import { unifiedDiff } from "./diff.ts";
import { readTree } from "./manifest.ts";
import { findById } from "./rows.ts";

// L2.knowledge.spec §3.5 show: 항목 하나와 파일별 변경. 바이너리 파일은 diff 없이 크기만 싣는다.

const MAX_FILES = 500;
const MAX_DIFF_CHARS = 200_000;

type ShownFile = LedgerShowOutput["files"][number];

function fileChanges(before: Tree | null, after: Tree | null, beforeKnown: boolean): ShownFile[] {
  const beforeByPath = new Map(before?.files.map((file) => [file.path, file.bytes]));
  const afterByPath = new Map(after?.files.map((file) => [file.path, file.bytes]));
  const paths = Array.from(new Set([...beforeByPath.keys(), ...afterByPath.keys()])).toSorted(
    compareBytes,
  );
  const shown: ShownFile[] = [];
  for (const path of paths) {
    const old = beforeByPath.get(path);
    const now = afterByPath.get(path);
    if (old !== undefined && now !== undefined && Buffer.compare(old, now) === 0) continue;
    const change: ShownFile["change"] =
      now === undefined ? "removed" : old === undefined && beforeKnown ? "added" : "modified";
    const oldText = old === undefined ? "" : utf8DecodeStrict(old);
    const newText = now === undefined ? "" : utf8DecodeStrict(now);
    const diffable =
      oldText !== undefined && newText !== undefined && (old !== undefined || beforeKnown);
    const diff = diffable
      ? unifiedDiff(path, oldText, newText).slice(0, MAX_DIFF_CHARS)
      : undefined;
    shown.push({
      path,
      change,
      ...(diff === undefined || diff === "" ? {} : { diff }),
      ...(old === undefined ? {} : { bytesBefore: old.byteLength }),
      ...(now === undefined ? {} : { bytesAfter: now.byteLength }),
    });
  }
  return shown.slice(0, MAX_FILES);
}

export function showEntry(
  deps: LedgerDeps,
  ledgerId: string,
): Result<LedgerShowOutput, KnowledgeFailure> {
  const found = deps.db.read((tx) => findById(tx, ledgerId));
  if (!found.ok) return err(fromStoreError(found.error, "ledger lookup"));
  if (!found.value.ok) return found.value;
  const record = found.value.value;
  if (record === undefined)
    return err(failure("not_found", `ledger entry ${ledgerId} does not exist`));

  let before: Tree | null = null;
  if (record.beforeManifest !== null) {
    const restored = readTree(deps.blobs, record.beforeManifest);
    if (!restored.ok) return restored;
    before = restored.value;
  }
  let after: Tree | null = null;
  if (record.afterManifest !== null) {
    const restored = readTree(deps.blobs, record.afterManifest);
    if (!restored.ok) return restored;
    after = restored.value;
  }
  // 이전 내용이 있었는데 목록이 없으면(바깥 편집 직전 내용을 모름) 추가가 아니라 변경으로 보인다
  const beforeKnown = record.beforeManifest !== null || record.entry.beforeHash === null;
  return ok({ entry: record.entry, files: fileChanges(before, after, beforeKnown) });
}
