import { err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { BlobError, ReadFailure, ThreadLifecycle } from "@fresnel/contracts/records";
import type { Kernel } from "./kernel.ts";
import type { ReviewState } from "./state.ts";
import type { ReviewFile, ReviewHunk } from "./types.ts";
import { normalizeReview, parseUnifiedDiff } from "./unified-diff.ts";

// L2.artifacts.spec §3.3.1, §4.2.9. 리뷰 본문(hunk의 줄 글)을 읽는 조립 루트 전용 자리다. 기능 메서드가 아니라서 F 계약을 늘리지 않는다.
// 상태(state.ts)에는 줄 글이 없으므로 정규화 diff blob을 다시 읽어 상태의 파일·hunk와 맞춘다. 맞지 않으면 손상이다(revert.ts와 같은 검사).
// 와이어 상한(줄 수, 글 길이)은 여기서 자르지 않는다. L4 포트가 와이어 값으로 옮길 때 적용한다.

/** 대화를 찾을 때 훑는 대화 행의 상한과 돌려주는 대화 수의 상한 [제안] */
const PENDING_SCAN_LIMIT = 1000;
const PENDING_THREAD_LIMIT = 50;
const THREAD_PAGE = 200;

interface ReviewTextLine {
  /** diff 접두 ` `, `+`, `-`에서 온다 */
  readonly kind: "context" | "add" | "del";
  /** 접두를 뗀 글. 줄바꿈은 없다 */
  readonly text: string;
}

interface ReviewTextHunk {
  readonly hunkId: string;
  /** `@@ -a,b +c,d @@ …` 줄 전체(상태의 값) */
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  /** 줄 끝 없음 표시(`\`)는 뺀다 */
  readonly lines: readonly ReviewTextLine[];
}

interface ReviewTextFile {
  readonly path: string;
  readonly binary: boolean;
  /** 이진 파일은 빈 목록이다 */
  readonly hunks: readonly ReviewTextHunk[];
}

export interface ReviewText {
  readonly reviewId: string;
  readonly files: readonly ReviewTextFile[];
}

export type ReviewTextFailure =
  | { readonly kind: "read_failed"; readonly failure: ReadFailure }
  | { readonly kind: "blob_failed"; readonly error: BlobError }
  /** 저장한 diff가 해석되지 않거나(unparsable) 상태의 파일·hunk와 맞지 않는다(mismatch) */
  | { readonly kind: "diff_damaged"; readonly reason: "unparsable" | "mismatch" };

/**
 * 리뷰 본문 읽기. `requestedThreadOf`는 이 프로세스가 승인을 요청한 리뷰의 대화(재시작 전 것은 모른다),
 * `pendingThreads`는 대기 승인이 있는 열린 대화, `read`는 한 대화의 리뷰 본문이다. 대화를 고르는 순서는 호출자(L4 포트)가 정한다.
 */
export interface ReviewTextReader {
  requestedThreadOf(reviewId: string): ThreadId | undefined;
  pendingThreads(): readonly ThreadId[];
  read(threadId: ThreadId, reviewId: string): Result<ReviewText | undefined, ReviewTextFailure>;
}

export interface ReviewTextDeps {
  readonly kernel: Kernel;
  readonly threads: Pick<ThreadLifecycle, "list">;
}

function damaged(reason: "unparsable" | "mismatch"): Result<never, ReviewTextFailure> {
  return err({ kind: "diff_damaged", reason });
}

/** 본문 줄을 와이어 종류와 글로 바꾼다. 접두가 없는 줄은 해석이 틀린 것이라 undefined다 */
function linesOf(lines: readonly string[]): ReviewTextLine[] | undefined {
  const out: ReviewTextLine[] = [];
  for (const line of lines) {
    const mark = line.charAt(0);
    const text = line.slice(1);
    if (mark === "\\") continue;
    if (mark === " ") out.push({ kind: "context", text });
    else if (mark === "+") out.push({ kind: "add", text });
    else if (mark === "-") out.push({ kind: "del", text });
    else return undefined;
  }
  return out;
}

/** 저장한 diff를 되읽어 상태의 파일·hunk와 맞춘다. 파일은 파일 순번과 경로로, hunk는 `hunkId`와 `patchSha256`으로 맞춘다 */
function textOf(state: ReviewState, diffText: string): Result<ReviewText, ReviewTextFailure> {
  const parsed = parseUnifiedDiff(diffText);
  if (!parsed.ok) return damaged("unparsable");
  const normalized = normalizeReview(parsed.value);
  if (!normalized.ok) return damaged("unparsable");

  const filesByIndex = new Map<number, ReviewFile>();
  const hunksById = new Map<string, ReviewHunk>();
  for (const file of normalized.value) {
    filesByIndex.set(file.fileIndex, file);
    for (const hunk of file.hunks) hunksById.set(hunk.hunkId, hunk);
  }

  const files: ReviewTextFile[] = [];
  for (const file of state.files) {
    const source = filesByIndex.get(file.fileIndex);
    if (source === undefined || source.path !== file.path || source.binary !== file.binary) {
      return damaged("mismatch");
    }
    const hunks: ReviewTextHunk[] = [];
    for (const hunk of file.hunks) {
      const found = hunksById.get(hunk.hunkId);
      if (found === undefined || found.patchSha256 !== hunk.patchSha256) {
        return damaged("mismatch");
      }
      const lines = linesOf(found.lines);
      if (lines === undefined) return damaged("unparsable");
      hunks.push({
        hunkId: hunk.hunkId,
        header: hunk.header,
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        lines,
      });
    }
    files.push({ path: file.path, binary: file.binary, hunks });
  }
  return ok({ reviewId: state.reviewId, files });
}

/** 대기 승인이 있는 열린 대화를 최근 갱신 순으로 찾는다. 대화 행을 `PENDING_SCAN_LIMIT`개까지만 보고 `PENDING_THREAD_LIMIT`개까지 돌려준다 */
function pendingThreadsOf(threads: Pick<ThreadLifecycle, "list">): readonly ThreadId[] {
  const found: ThreadId[] = [];
  let scanned = 0;
  let cursor: string | undefined;
  while (scanned < PENDING_SCAN_LIMIT && found.length < PENDING_THREAD_LIMIT) {
    const page = threads.list({ limit: THREAD_PAGE, ...(cursor === undefined ? {} : { cursor }) });
    scanned += page.threads.length;
    for (const row of page.threads) {
      if (row.pendingApprovals > 0) found.push(row.threadId);
    }
    if (page.nextCursor === null || page.threads.length === 0) break;
    cursor = page.nextCursor;
  }
  return found.slice(0, PENDING_THREAD_LIMIT);
}

export function createReviewTextReader(deps: ReviewTextDeps): ReviewTextReader {
  return {
    requestedThreadOf(reviewId) {
      for (const target of deps.kernel.approvalTargets.values()) {
        if (target.reviewId === reviewId) return target.threadId;
      }
      return undefined;
    },
    pendingThreads() {
      return pendingThreadsOf(deps.threads);
    },
    read(threadId, reviewId) {
      const loaded = deps.kernel.load(threadId, reviewId);
      if (!loaded.ok) return err({ kind: "read_failed", failure: loaded.error });
      if (loaded.value === undefined) return ok(undefined);
      const bytes = deps.kernel.deps.blobs.readBlob(loaded.value.diff);
      if (!bytes.ok) return err({ kind: "blob_failed", error: bytes.error });
      return textOf(loaded.value, new TextDecoder().decode(bytes.value));
    },
  };
}
