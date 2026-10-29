import type { Logger, Result } from "@xeon/contracts";
import { ok, err } from "@xeon/contracts";
import type { ReviewView } from "@xeon/contracts/capabilities";
import type {
  IdFactory,
  JsonValue,
  LocalIdFactory,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  requestKeyFor,
  type CommitResult,
  type EventKind,
  type ProducerHandle,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StoreError,
  type StoreService,
} from "@xeon/contracts/records";
import type { L2ApprovalSnapshot, L2ApprovalsPort } from "@xeon/contracts/services";
import { sha256Hex } from "../hash.ts";
import type { ExecutionGuardPort, ReviewFilesPort, ReviewQueuePort } from "../ports.ts";
import { readEvents } from "./collect.ts";
import { foldReview, type ReviewState } from "./state.ts";

// 리뷰 서비스가 공유하는 의존과 도우미. 상태 읽기(이벤트 접기), 커밋, 승인 요청, 보기 만들기.

export const REVIEWS_PRODUCER = "cap.artifacts";

interface ReviewSettings {
  readonly deliverAs: "steer" | "followUp" | "next";
}

export interface ReviewsDeps {
  readonly session: Pick<SessionService, "commit" | "feed">;
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  readonly blobs: Pick<StoreService, "putBlob" | "readBlob">;
  /** 없으면 거절 적용은 `revert_unavailable`이다 */
  readonly files: ReviewFilesPort | undefined;
  /** 없으면 거절 적용을 하지 않는다(가드를 거치지 않고 쓰지 않는다) */
  readonly guard: ExecutionGuardPort | undefined;
  /** 없으면 열 때 승인 요청을 내지 않는다 */
  readonly approvals: L2ApprovalsPort | undefined;
  /** 없으면 제출해도 에이전트 입력으로 전달하지 않는다 */
  readonly queue: ReviewQueuePort | undefined;
  readonly logger: Logger;
  readonly settings: () => ReviewSettings;
}

/** 승인 요청 하나가 가리키는 리뷰 */
interface ApprovalTarget {
  readonly threadId: ThreadId;
  readonly reviewId: string;
}

export function commitKey(...parts: readonly string[]): string {
  return ["artifact", "review", ...parts.map((part) => commitKeyPart(part, sha256Hex))].join(":");
}

export interface Kernel {
  readonly deps: ReviewsDeps;
  /** 승인 id → 리뷰. 이 프로세스에서 요청한 승인만 안다(재시작 뒤에는 승인 서비스에서 찾는다) */
  readonly approvalTargets: Map<string, ApprovalTarget>;
  load(threadId: ThreadId, reviewId: string): Result<ReviewState | undefined, ReadFailure>;
  commit(request: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly key: string;
    readonly fingerprint: JsonValue;
    readonly events: readonly { readonly kind: EventKind; readonly payload: JsonValue }[];
  }): Result<
    Extract<CommitResult, { status: "committed" }>,
    StoreError | { readonly kind: "rejected"; readonly code: string }
  >;
  requestApproval(state: ReviewState, threadId: ThreadId, keyRaw: string): Promise<void>;
  /** 한 리뷰의 연산을 줄 세운다. 같은 리뷰의 결정, 제출, 승인 해결이 겹쳐 돌지 않게 한다 */
  withLock<T>(reviewId: string, work: () => Promise<T>): Promise<T>;
}

export function createKernel(deps: ReviewsDeps): Kernel {
  const approvalTargets = new Map<string, ApprovalTarget>();
  const locks = new Map<string, Promise<unknown>>();

  function draftOf(
    threadId: ThreadId,
    turnId: TurnId | null,
    kind: EventKind,
    payload: JsonValue,
  ): StampedDraft {
    return deps.producer.draft({
      id: deps.ids.next("evt"),
      kind,
      threadId,
      turnId,
      stepId: null,
      causationId: null,
      correlationId: null,
      payload,
    });
  }

  return {
    deps,
    approvalTargets,
    load(threadId, reviewId) {
      const events = readEvents(deps.session.feed, threadId, ["artifact.review_"]);
      if (!events.ok) return events;
      return ok(foldReview(reviewId, events.value));
    },
    commit(request) {
      const committed = deps.session.commit({
        threadId: request.threadId,
        requestId: request.key,
        fingerprintSource: request.fingerprint,
        build: () => ({
          kind: "append",
          drafts: request.events.map((event) =>
            draftOf(request.threadId, request.turnId, event.kind, event.payload),
          ),
          checkpoint: null,
        }),
      });
      if (!committed.ok) return committed;
      const result = committed.value;
      if (result.status === "committed") return ok(result);
      if (result.status === "rejected") return err({ kind: "rejected", code: result.code });
      return err({ kind: "rejected", code: "key_reused" });
    },
    async requestApproval(state, threadId, keyRaw) {
      const approvals = deps.approvals;
      if (approvals === undefined) return;
      const result = await approvals.request({
        threadId,
        kind: "review",
        blocking: false,
        requestId: requestKeyFor(keyRaw, sha256Hex),
        subject: {
          reviewId: state.reviewId,
          artifactId: state.artifactId,
          title: state.title,
          round: state.round,
          files: state.files.map((file) => ({
            path: file.path,
            change: file.change,
            binary: file.binary,
            hunks: file.hunks.length,
          })),
        },
      });
      if (!result.ok) {
        deps.logger.warn("artifacts.review_approval_failed", {
          reviewId: state.reviewId,
          reason: result.error.kind,
        });
        return;
      }
      const snapshot: L2ApprovalSnapshot = result.value;
      approvalTargets.set(snapshot.approvalId, { threadId, reviewId: state.reviewId });
    },
    withLock(reviewId, work) {
      const previous = locks.get(reviewId) ?? Promise.resolve();
      const next = previous.then(work, work);
      const release = (): undefined => {
        if (locks.get(reviewId) === tail) locks.delete(reviewId);
        return undefined;
      };
      const tail: Promise<undefined> = next.then(release, release);
      locks.set(reviewId, tail);
      return next;
    },
  };
}

export function viewOf(state: ReviewState, threadId: ThreadId): ReviewView {
  const counts = new Map<string, number>();
  for (const comment of state.comments) {
    if (comment.target.type === "hunk") {
      counts.set(comment.target.hunkId, (counts.get(comment.target.hunkId) ?? 0) + 1);
    }
  }
  return {
    reviewId: state.reviewId,
    threadId,
    artifactId: state.artifactId,
    title: state.title,
    status: state.status,
    round: state.round,
    files: state.files.map((file) => ({
      fileIndex: file.fileIndex,
      path: file.path,
      oldPath: file.oldPath,
      change: file.change,
      binary: file.binary,
      hunks: file.hunks.map((hunk) => ({
        hunkId: hunk.hunkId,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        decision: hunk.decision,
        applied: hunk.applied,
        commentCount: counts.get(hunk.hunkId) ?? 0,
      })),
    })),
    comments: state.comments.map((comment) => ({
      commentId: comment.commentId,
      target: comment.target,
      body: comment.body,
      round: comment.round,
      deliveredRound: comment.deliveredRound,
    })),
  };
}
