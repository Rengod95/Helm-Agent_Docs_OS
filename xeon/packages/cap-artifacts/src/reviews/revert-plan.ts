import { canonicalJson } from "@fresnel/contracts";
import type { BlobRef, StoreService } from "@fresnel/contracts/records";
import { sha256Hex } from "../hash.ts";
import type { FileState, ReviewState } from "./state.ts";
import { hunkSides, normalizeReview, parseUnifiedDiff } from "./unified-diff.ts";
import type { ReviewHunk } from "./types.ts";

// L2.artifacts.spec §4.2.5와 hooks-core-boundary U-11. 되돌림 계획의 읽기 쪽: 되돌릴 수 있는 파일인지, 저장한 diff에서 hunk 읽기,
// 되돌림 쓰기 입력의 해시. 되돌림을 실행하는 `revert.ts`와 검토 카드를 내는 `kernel.ts`가 같이 쓴다(둘이 서로를 import하지 않게 나눴다).

type Blobs = Pick<StoreService, "readBlob">;

export function isRevertable(file: FileState): string | undefined {
  if (file.binary) return "binary files are decided per file and cannot be reverted";
  if (file.change === "renamed") return "renamed files cannot be reverted";
  if (file.change === "deleted") return "deleted files cannot be restored by a hunk revert";
  return undefined;
}

/** 저장한 정규화 diff blob을 다시 읽어 hunk를 찾는다. 읽거나 해석하지 못하면 undefined다 */
export function loadReviewHunks(
  blobs: Blobs,
  ref: BlobRef,
): ReadonlyMap<string, ReviewHunk> | undefined {
  const bytes = blobs.readBlob(ref);
  if (!bytes.ok) return undefined;
  const parsed = parseUnifiedDiff(new TextDecoder().decode(bytes.value));
  if (!parsed.ok) return undefined;
  const files = normalizeReview(parsed.value);
  if (!files.ok) return undefined;
  return new Map(files.value.flatMap((file) => file.hunks.map((hunk) => [hunk.hunkId, hunk])));
}

/** 되돌림 쓰기 호출의 입력(`workspace.files.edit`). 카드가 싣는 해시와 실제 호출이 같은 모양에서 나온다 */
function revertWriteInput(
  path: string,
  oldText: string,
  newText: string,
): {
  readonly path: string;
  readonly edits: readonly { readonly oldText: string; readonly newText: string }[];
} {
  return { path, edits: [{ oldText, newText }] };
}

/** 되돌림 쓰기 입력의 해시. 검토 카드의 `writes`와 엔진이 승인 상속을 대조하는 값이다(U-11) */
function revertWriteHash(path: string, oldText: string, newText: string): string {
  return sha256Hex(canonicalJson(revertWriteInput(path, oldText, newText)));
}

/**
 * 이 검토가 앞으로 할 수 있는 되돌림 쓰기(되돌릴 수 있고 아직 되돌리지 않은 hunk)의 해시 목록. 검토 카드 본문에 싣는다.
 * 읽거나 해석하지 못하면 빈 목록이라 그 호출은 새 승인 카드를 띄운다
 */
export function revertWriteHashes(blobs: Blobs, state: ReviewState): readonly string[] {
  const loaded = loadReviewHunks(blobs, state.diff);
  if (loaded === undefined) return [];
  const hashes = new Set<string>();
  for (const file of state.files) {
    if (isRevertable(file) !== undefined) continue;
    for (const hunk of file.hunks) {
      if (hunk.applied === "reverted") continue;
      const source = loaded.get(hunk.hunkId);
      if (source === undefined || source.patchSha256 !== hunk.patchSha256) continue;
      if (file.change === "added" && source.oldLines === 0) continue;
      const sides = hunkSides(source);
      if (sides.newText === "") continue;
      hashes.add(revertWriteHash(file.path, sides.newText, sides.oldText));
    }
  }
  return [...hashes].slice(0, 4096);
}
