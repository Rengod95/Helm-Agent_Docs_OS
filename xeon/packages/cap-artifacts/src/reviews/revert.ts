import type { ApplyOutcome } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { Kernel } from "./kernel.ts";
import type { FileState, HunkState, ReviewState } from "./state.ts";
import type { BlobRef } from "@xeon/contracts/records";
import { hunkSides, normalizeReview, parseUnifiedDiff } from "./unified-diff.ts";
import type { ReviewHunk } from "./types.ts";

// L2.artifacts.spec §4.2.5 후보 A. 거절한 hunk를 `workspace.files`의 편집으로 되돌린다. 승인한 hunk와 다른 줄은 건드리지 않는다.
// [결정: 오케스트레이터 기본값] 파일 단위 원자성은 두지 않고 hunk마다 편집 하나를 낸다. 같은 파일에서는 나중 hunk부터(뒤쪽 편집이 앞쪽 줄 위치를
// 바꾸지 않고, 같은 파일을 여러 번 고친 변경은 최신 것부터 풀어야 앞 편집의 새 쪽 내용이 남아 있다). 각 편집은 workspace가 원자적으로 쓰고
// 동시 변경을 감지한다. 실패한 hunk는 conflict로 기록하고 이미 되돌린 hunk는 그대로 둔다.

export type RevertFailure = { readonly kind: "revert_unavailable"; readonly message: string };

function isRevertable(file: FileState): string | undefined {
  if (file.binary) return "binary files are decided per file and cannot be reverted";
  if (file.change === "renamed") return "renamed files cannot be reverted";
  if (file.change === "deleted") return "deleted files cannot be restored by a hunk revert";
  return undefined;
}

function pushOutcome(
  outcomes: ApplyOutcome[],
  path: string,
  result: ApplyOutcome["result"],
  hunkId: string,
  detail: string | undefined,
): void {
  const method = result === "skipped" ? "none" : "workspace_files";
  const existing = outcomes.find(
    (outcome) => outcome.path === path && outcome.result === result && outcome.detail === detail,
  );
  if (existing !== undefined) {
    existing.hunkIds.push(hunkId);
    return;
  }
  outcomes.push({
    path,
    hunkIds: [hunkId],
    result,
    method,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** 거절되었고 아직 되돌리지 않은 hunk가 있는 파일과 hunk(뒤에서부터) */
function revertTargets(
  state: ReviewState,
): readonly { readonly file: FileState; readonly hunks: readonly HunkState[] }[] {
  return state.files
    .map((file) => ({
      file,
      hunks: file.hunks
        .filter((hunk) => hunk.decision === "rejected" && hunk.applied !== "reverted")
        .toReversed(),
    }))
    .filter((target) => target.hunks.length > 0);
}

/** 저장한 정규화 diff blob을 다시 읽어 hunk를 찾는다. 읽거나 해석하지 못하면 undefined다 */
function loadReviewHunks(
  blobs: Kernel["deps"]["blobs"],
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

function clip(text: string): string {
  return text.length <= 400 ? text : `${text.slice(0, 397)}...`;
}

/**
 * 거절한 hunk를 되돌리고 결과를 돌려준다. 되돌림 경로를 쓸 수 없으면(파일 포트나 가드가 없음) 값으로 알린다.
 * 가드(`guard.output.before`, target `execution`)가 막은 hunk는 conflict이고 파일에 쓰지 않는다.
 */
export async function applyRejections(
  kernel: Kernel,
  threadId: ThreadId,
  state: ReviewState,
  signal: AbortSignal | undefined,
): Promise<{ readonly outcomes: ApplyOutcome[] } | RevertFailure> {
  const targets = revertTargets(state);
  if (targets.length === 0) return { outcomes: [] };
  const { files, guard } = kernel.deps;
  if (files === undefined || guard === undefined) {
    return {
      kind: "revert_unavailable",
      message: "Reverting rejected hunks needs workspace.files and the loop guard.",
    };
  }
  const loaded = loadReviewHunks(kernel.deps.blobs, state.diff);
  const outcomes: ApplyOutcome[] = [];
  for (const { file, hunks } of targets) {
    const skipReason = isRevertable(file);
    for (const hunk of hunks) {
      if (skipReason !== undefined) {
        pushOutcome(outcomes, file.path, "skipped", hunk.hunkId, skipReason);
        continue;
      }
      const source = loaded?.get(hunk.hunkId);
      if (source === undefined || source.patchSha256 !== hunk.patchSha256) {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          "The stored diff no longer matches this hunk.",
        );
        continue;
      }
      if (file.change === "added" && source.oldLines === 0) {
        pushOutcome(
          outcomes,
          file.path,
          "skipped",
          hunk.hunkId,
          "The creation of a new file cannot be reverted here. Delete the file to undo it.",
        );
        continue;
      }
      const sides = hunkSides(source);
      if (sides.newText === "") {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          "The hunk has no lines to locate in the file.",
        );
        continue;
      }
      const turnId = state.openTurnId;
      if (turnId === null) {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          "The review has no turn to run the output guard against.",
        );
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- hunk는 뒤에서부터 하나씩 되돌린다 (L2.artifacts.spec §4.2.5)
      const guarded = await guard.check({
        threadId,
        turnId,
        content: `${file.path}\n${sides.oldText}`,
        requestId: `${state.reviewId}:${hunk.hunkId}`,
        ...(signal === undefined ? {} : { signal }),
      });
      if (!guarded.ok) {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          clip(`Guard check failed: ${guarded.error.kind}.`),
        );
        continue;
      }
      if (guarded.value.status === "blocked") {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          clip(`Blocked by a guard: ${guarded.value.reason}`),
        );
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- hunk를 뒤에서부터 하나씩 되돌린다 (L2.artifacts.spec §4.2.5)
      const replaced = await files.replace({
        threadId,
        path: file.path,
        oldText: sides.newText,
        newText: sides.oldText,
        requestId: `${state.reviewId}:${hunk.hunkId}`,
        ...(signal === undefined ? {} : { signal }),
      });
      if (replaced.ok) {
        pushOutcome(outcomes, file.path, "reverted", hunk.hunkId, undefined);
      } else {
        pushOutcome(
          outcomes,
          file.path,
          "conflict",
          hunk.hunkId,
          clip(`${replaced.error.code}: ${replaced.error.message}`),
        );
      }
    }
  }
  return { outcomes };
}
