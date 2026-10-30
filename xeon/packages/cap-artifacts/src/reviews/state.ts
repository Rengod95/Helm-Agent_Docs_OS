import { parse } from "@xeon/contracts";
import type { TurnId } from "@xeon/contracts/conversation";
import {
  ReviewAppliedPayloadSchema,
  ReviewClosedPayloadSchema,
  ReviewCommentedPayloadSchema,
  ReviewDecidedPayloadSchema,
  ReviewOpenedPayloadSchema,
  ReviewSubmittedPayloadSchema,
  type BlobRef,
  type DurableEventEnvelope,
  type ReviewCommentedPayload,
  type ReviewOpenedPayload,
} from "@xeon/contracts/records";
import type { FileChangeKind, HunkApplied, HunkDecision } from "./types.ts";

// L2.artifacts.spec §4.2.3. 리뷰 상태는 `artifact.review_*` 이벤트를 커밋 순서로 접어 얻는다(투영 테이블 없음 [결정: 오케스트레이터 기본값]).
// 접는 규칙은 순수하고, 같은 이벤트 열은 늘 같은 상태를 낸다.

type ReviewStatus = "open" | "submitted" | "closed";

export interface HunkState {
  readonly hunkId: string;
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly patchSha256: string;
  readonly decision: HunkDecision;
  readonly applied: HunkApplied;
  /** 마지막으로 결정이 기록된 라운드. 결정이 없으면 null */
  readonly decidedRound: number | null;
}

export interface FileState {
  readonly fileIndex: number;
  readonly path: string;
  readonly oldPath: string | null;
  readonly change: FileChangeKind;
  readonly binary: boolean;
  readonly hunks: readonly HunkState[];
}

interface CommentState {
  readonly commentId: string;
  readonly target: ReviewCommentedPayload["target"];
  readonly body: string;
  readonly round: number;
  /** 에이전트 입력으로 전달된 라운드. 아직이면 null */
  readonly deliveredRound: number | null;
}

export interface ReviewState {
  readonly reviewId: string;
  readonly artifactId: string;
  readonly title: string;
  readonly status: ReviewStatus;
  /** 현재 라운드. 열 때 1, 제출 뒤 새 결정이 오면 1 증가 */
  readonly round: number;
  readonly deliverAs: "steer" | "followUp" | "next";
  readonly diff: BlobRef;
  /** 리뷰를 연 turn. 거절 적용 때 가드 검사의 turnId로 쓴다 */
  readonly openTurnId: TurnId | null;
  readonly files: readonly FileState[];
  readonly comments: readonly CommentState[];
}

function openedState(payload: ReviewOpenedPayload, turnId: TurnId | null): ReviewState {
  return {
    reviewId: payload.reviewId,
    artifactId: payload.artifactId,
    title: payload.title,
    status: "open",
    round: 1,
    deliverAs: payload.deliverAs,
    diff: payload.diff,
    openTurnId: turnId,
    files: payload.files.map((file) => ({
      fileIndex: file.fileIndex,
      path: file.path,
      oldPath: file.oldPath,
      change: changeOf(file.change),
      binary: file.binary,
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        decision: "pending",
        applied: "none",
        decidedRound: null,
      })),
    })),
    comments: [],
  };
}

function changeOf(value: string): FileChangeKind {
  if (value === "added" || value === "deleted" || value === "renamed") return value;
  return "modified";
}

function fileWithHunks(file: FileState, change: (hunk: HunkState) => HunkState): FileState {
  return { ...file, hunks: file.hunks.map(change) };
}

/** 제출 뒤에 결정이나 코멘트가 오면 라운드를 늘리고 열린 상태로 돌아간다. 이미 열려 있으면 그대로다 */
function reopened(state: ReviewState, round: number): ReviewState {
  return state.status === "closed"
    ? state
    : { ...state, status: "open", round: Math.max(state.round, round) };
}

/** 새 결정이나 코멘트를 받을 때 쓸 라운드. 제출한 상태면 다음 라운드다 */
export function roundForNewInput(state: ReviewState): number {
  return state.status === "submitted" ? state.round + 1 : state.round;
}

/**
 * 리뷰 한 건의 이벤트(`artifact.review_*`)를 접는다. 다른 리뷰의 이벤트와 모양이 틀린 이벤트는 건너뛴다.
 * 첫 `artifact.review_opened`가 없으면 undefined다.
 */
export function foldReview(
  reviewId: string,
  events: readonly DurableEventEnvelope[],
): ReviewState | undefined {
  let state: ReviewState | undefined;
  for (const event of events) {
    if (event.kind === "artifact.review_opened") {
      const payload = parse(ReviewOpenedPayloadSchema, event.payload);
      if (payload.ok && payload.value.reviewId === reviewId && state === undefined) {
        state = openedState(payload.value, event.turnId);
      }
      continue;
    }
    if (event.kind === "artifact.review_decided") {
      const payload = parse(ReviewDecidedPayloadSchema, event.payload);
      if (state === undefined || !payload.ok || payload.value.reviewId !== reviewId) continue;
      const decisions = new Map(payload.value.decisions.map((d) => [d.hunkId, d.decision]));
      const reopenedState = reopened(state, payload.value.round);
      state = {
        ...reopenedState,
        files: reopenedState.files.map((file) =>
          fileWithHunks(file, (hunk) => {
            const decision = decisions.get(hunk.hunkId);
            return decision === undefined
              ? hunk
              : { ...hunk, decision, decidedRound: payload.value.round };
          }),
        ),
      };
      continue;
    }
    if (event.kind === "artifact.review_commented") {
      const payload = parse(ReviewCommentedPayloadSchema, event.payload);
      if (state === undefined || !payload.ok || payload.value.reviewId !== reviewId) continue;
      const reopenedState = reopened(state, payload.value.round);
      state = {
        ...reopenedState,
        comments: [
          ...reopenedState.comments,
          {
            commentId: payload.value.commentId,
            target: payload.value.target,
            body: payload.value.body,
            round: payload.value.round,
            deliveredRound: null,
          },
        ],
      };
      continue;
    }
    if (event.kind === "artifact.review_applied") {
      const payload = parse(ReviewAppliedPayloadSchema, event.payload);
      if (state === undefined || !payload.ok || payload.value.reviewId !== reviewId) continue;
      const applied = new Map<string, HunkApplied>();
      for (const outcome of payload.value.outcomes) {
        if (outcome.result === "skipped") continue;
        for (const hunkId of outcome.hunkIds) {
          applied.set(hunkId, outcome.result === "reverted" ? "reverted" : "conflict");
        }
      }
      state = {
        ...state,
        files: state.files.map((file) =>
          fileWithHunks(file, (hunk) => ({
            ...hunk,
            applied: applied.get(hunk.hunkId) ?? hunk.applied,
          })),
        ),
      };
      continue;
    }
    if (event.kind === "artifact.review_submitted") {
      const payload = parse(ReviewSubmittedPayloadSchema, event.payload);
      if (state === undefined || !payload.ok || payload.value.reviewId !== reviewId) continue;
      const round = payload.value.round;
      state = {
        ...state,
        status: "submitted",
        round,
        comments: state.comments.map((comment) =>
          comment.deliveredRound === null && comment.round <= round
            ? { ...comment, deliveredRound: round }
            : comment,
        ),
      };
      continue;
    }
    if (event.kind === "artifact.review_closed") {
      const payload = parse(ReviewClosedPayloadSchema, event.payload);
      if (state === undefined || !payload.ok || payload.value.reviewId !== reviewId) continue;
      state = { ...state, status: "closed" };
      continue;
    }
  }
  return state;
}
