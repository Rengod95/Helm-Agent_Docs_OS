import {
  ArtifactsReviews,
  type ApplyOutcome,
  type CapabilityApi,
  type CommentView,
  type ReviewView,
} from "@xeon/contracts/capabilities";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import {
  ReviewOpenedPayloadSchema,
  type EventKind,
  type ReviewOpenedPayload,
} from "@xeon/contracts/records";
import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import { actorOf, requestIdOf, scopeOf, type CallScope } from "../call.ts";
import { reject, storeRejection } from "../errors.ts";
import { collectDiffs } from "./collect.ts";
import { renderDelivery } from "./deliver.ts";
import { commitKey, createKernel, viewOf, type Kernel, type ReviewsDeps } from "./kernel.ts";
import { applyRejections } from "./revert.ts";
import { roundForNewInput, type HunkState, type ReviewState } from "./state.ts";
import {
  mergeDiffFiles,
  normalizeReview,
  parseUnifiedDiff,
  renderReviewDiff,
} from "./unified-diff.ts";
import type { DiffFile } from "./types.ts";

// L2.artifacts.spec §3.3, §4.2. artifacts.reviews 서비스. 리뷰의 정본은 artifact.review_* 이벤트이고 상태는 이벤트를 접어 얻는다.
// 사용자 결정은 승인 프로토콜(kind review)의 답으로 들어온다(answer.ts).

const CAPABILITY = ArtifactsReviews.id;

type Api = CapabilityApi<typeof ArtifactsReviews>;
type ChangeSource = Parameters<Api["open"]>[0]["changes"];
type SubmitOutput = Awaited<ReturnType<Api["submit"]>>;

export interface ReviewsRuntime {
  readonly api: Api;
  readonly kernel: Kernel;
  /** 제출한다. 호출자가 `kernel.withLock(reviewId, …)` 안에서 불러야 한다(answer.ts가 결정 반영과 한 줄로 묶는다) */
  submitUnlocked(
    threadId: ThreadId,
    reviewId: string,
    options: SubmitOptions,
  ): Promise<Result<SubmitOutput, SubmitFailure>>;
}

interface SubmitOptions {
  readonly approveRemaining: boolean;
  readonly deliverAs?: "steer" | "followUp" | "next";
  readonly by: "user" | "model" | "group";
  readonly turnId: CallScope["turnId"];
  readonly signal: AbortSignal | undefined;
}

type SubmitFailure =
  | { readonly kind: "not_found" }
  | { readonly kind: "review_closed" }
  | { readonly kind: "decisions_pending" }
  | { readonly kind: "revert_unavailable"; readonly message: string }
  | { readonly kind: "storage"; readonly cause: Parameters<typeof storeRejection>[2] };

function defaultTitle(paths: readonly string[]): string {
  const first = paths[0];
  if (first === undefined) return "Review changes";
  return paths.length === 1
    ? `Review ${first}`
    : `Review ${first} and ${String(paths.length - 1)} more`;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function readThread(
  kernel: Kernel,
  method: string,
  scope: CallScope,
  reviewId: string,
): ReviewState {
  const loaded = kernel.load(scope.threadId, reviewId);
  if (!loaded.ok) throw storeRejection(CAPABILITY, method, loaded.error);
  if (loaded.value === undefined) {
    throw reject(
      CAPABILITY,
      method,
      "not_found",
      `Review ${reviewId} does not exist in this thread.`,
    );
  }
  return loaded.value;
}

function allHunks(state: ReviewState): readonly HunkState[] {
  return state.files.flatMap((file) => file.hunks);
}

function basisOf(scope: CallScope, source: ChangeSource): ReviewOpenedPayload["basis"] {
  switch (source.type) {
    case "turn": {
      const turnId = source.turnId ?? scope.turnId;
      if (turnId === null) throw new Error("unreachable: turn basis without a turn");
      return { type: "turn", turnId, toolCallIds: [] };
    }
    case "toolCalls":
      return { type: "toolCalls", toolCallIds: [...source.toolCallIds] };
    case "checkpoint":
      return {
        type: "checkpoint",
        checkpointId: source.checkpointId,
        paths: source.paths === undefined ? null : [...source.paths],
      };
    case "patch":
      return { type: "patch" };
    default:
      return assertNever(source, "ChangeSource");
  }
}

function checkTarget(method: string, state: ReviewState, target: CommentView["target"]): void {
  if (target.type === "review") return;
  if (target.type === "file") {
    if (!state.files.some((file) => file.path === target.path)) {
      throw reject(CAPABILITY, method, "invalid_input", `The review has no file ${target.path}.`);
    }
    return;
  }
  const hunk = allHunks(state).find((candidate) => candidate.hunkId === target.hunkId);
  if (hunk === undefined) {
    throw reject(CAPABILITY, method, "hunk_unknown", `The review has no hunk ${target.hunkId}.`);
  }
  if (target.line === undefined) return;
  const start = target.line.side === "old" ? hunk.oldStart : hunk.newStart;
  const count = target.line.side === "old" ? hunk.oldLines : hunk.newLines;
  if (target.line.number < start || target.line.number >= start + Math.max(count, 1)) {
    throw reject(CAPABILITY, method, "line_out_of_range", "The line is outside the hunk.");
  }
}

function submitRejection(method: string, failure: SubmitFailure): Error {
  switch (failure.kind) {
    case "not_found":
      return reject(CAPABILITY, method, "not_found", "The review does not exist in this thread.");
    case "review_closed":
      return reject(CAPABILITY, method, "review_closed", "The review is closed.");
    case "decisions_pending":
      return reject(CAPABILITY, method, "decisions_pending", "Some hunks have no decision yet.");
    case "revert_unavailable":
      return reject(CAPABILITY, method, "revert_unavailable", failure.message, {
        retryable: true,
      });
    case "storage":
      return storeRejection(CAPABILITY, method, failure.cause);
    default:
      return assertNever(failure, "SubmitFailure");
  }
}

export function createReviews(deps: ReviewsDeps): ReviewsRuntime {
  const kernel = createKernel(deps);

  function stateOf(method: string, scope: CallScope, reviewId: string): ReviewState {
    return readThread(kernel, method, scope, reviewId);
  }

  function commitOrThrow(method: string, request: Parameters<Kernel["commit"]>[0]): void {
    const committed = kernel.commit(request);
    if (!committed.ok) {
      if (committed.error.kind === "rejected") {
        throw reject(
          CAPABILITY,
          method,
          "internal_error",
          `The commit was rejected: ${committed.error.code}.`,
        );
      }
      throw storeRejection(CAPABILITY, method, committed.error);
    }
  }

  function collect(method: string, scope: CallScope, source: ChangeSource): DiffFile[] {
    const texts: string[] = [];
    let basis: "turn" | "toolCalls" | "patch";
    switch (source.type) {
      case "checkpoint":
        throw reject(
          CAPABILITY,
          method,
          "source_unsupported",
          "Checkpoint changes cannot be reviewed yet.",
        );
      case "patch":
        texts.push(source.patch);
        basis = "patch";
        break;
      case "turn": {
        const turnId = source.turnId ?? scope.turnId;
        if (turnId === null) {
          throw reject(
            CAPABILITY,
            method,
            "invalid_input",
            "A turn review needs a turnId or a turn context.",
          );
        }
        const collected = collectDiffs(deps.session.feed, scope.threadId, { type: "turn", turnId });
        if (!collected.ok) throw storeRejection(CAPABILITY, method, collected.error);
        texts.push(...collected.value.map((item) => item.diff));
        basis = "turn";
        break;
      }
      case "toolCalls": {
        const collected = collectDiffs(deps.session.feed, scope.threadId, {
          type: "toolCalls",
          toolCallIds: source.toolCallIds,
        });
        if (!collected.ok) throw storeRejection(CAPABILITY, method, collected.error);
        texts.push(...collected.value.map((item) => item.diff));
        basis = "toolCalls";
        break;
      }
      default:
        return assertNever(source, "ChangeSource");
    }
    const files: DiffFile[] = [];
    for (const [index, text] of texts.entries()) {
      const parsed = parseUnifiedDiff(text);
      if (!parsed.ok) {
        throw reject(
          CAPABILITY,
          method,
          "diff_unparsable",
          "The diff cannot be read as a unified diff.",
          {
            detail: { source: `${basis}:${String(index)}`, line: parsed.error.line },
          },
        );
      }
      files.push(...parsed.value);
    }
    return files;
  }

  const api: Api = {
    async open(input, options) {
      const method = "open";
      const scope = scopeOf(CAPABILITY, method, options, input.threadId);
      const requestId = requestIdOf(CAPABILITY, method, options);
      const diffFiles = collect(method, scope, input.changes);
      if (diffFiles.length === 0) {
        throw reject(CAPABILITY, method, "no_changes", "There are no changes to review.");
      }
      const normalized = normalizeReview(mergeDiffFiles(diffFiles));
      if (!normalized.ok) {
        throw reject(
          CAPABILITY,
          method,
          "review_too_large",
          "The review has too many files or hunks.",
        );
      }
      const files = normalized.value;
      const diffText = renderReviewDiff(files);
      const blob = deps.blobs.putBlob(utf8(diffText), "text/x-diff");
      if (!blob.ok) throw storeRejection(CAPABILITY, method, { kind: "io", code: blob.error.kind });
      const reviewId = deps.localIds.next("rvw");
      const artifactId = deps.localIds.next("art");
      const title = input.title ?? defaultTitle(files.map((file) => file.path));
      const hunkCount = files.reduce((n, file) => n + file.hunks.length, 0);
      const basis = basisOf(scope, input.changes);
      const opened: ReviewOpenedPayload = {
        reviewId,
        artifactId,
        title,
        basis,
        diff: blob.value,
        files: files.map((file) => ({
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
            patchSha256: hunk.patchSha256,
          })),
        })),
        deliverAs: input.deliverAs ?? deps.settings().deliverAs,
        approvalId: null,
      };
      const committed = kernel.commit({
        threadId: scope.threadId,
        turnId: scope.turnId,
        key: commitKey("open", requestId),
        fingerprint: {
          title: input.title ?? null,
          basis: basis.type,
          patchSha: files.map((file) => file.hunks.map((hunk) => hunk.patchSha256)),
        },
        events: [
          {
            kind: "artifact.registered",
            payload: {
              artifactId,
              kind: "changeset",
              title,
              version: 1,
              content: blob.value,
              sourcePath: null,
              meta: { preview: { files: files.length, hunks: hunkCount } },
              turnId: scope.turnId,
              toolCallId: scope.context?.toolCallId ?? null,
              producer: scope.context?.caller.kind === "model" ? "model" : "cap.artifacts",
            },
          },
          { kind: "artifact.review_opened", payload: toJson(opened) },
        ],
      });
      if (!committed.ok) {
        if (committed.error.kind === "rejected") {
          throw reject(
            CAPABILITY,
            method,
            "internal_error",
            `The commit was rejected: ${committed.error.code}.`,
          );
        }
        throw storeRejection(CAPABILITY, method, committed.error);
      }
      // 다시 부른 호출이면 처음 커밋의 리뷰 id를 쓴다(재시도는 새 id를 만들었어도 커밋은 처음 것이다)
      const stored = firstOpened(committed.value.firstSeq, committed.value.lastSeq, scope.threadId);
      const finalId = stored?.reviewId ?? reviewId;
      const state = stateOf(method, scope, finalId);
      if (input.requestApproval !== false) {
        await kernel.requestApproval(state, scope.threadId, `review:${finalId}:a1`);
      }
      return viewOf(state, scope.threadId);
    },

    get(input, options) {
      const scope = scopeOf(CAPABILITY, "get", options);
      return Promise.resolve(viewOf(stateOf("get", scope, input.reviewId), scope.threadId));
    },

    approve: (input, options) => decide("approve", input, options, "approved"),
    reject: (input, options) => decide("reject", input, options, "rejected"),

    comment(input, options) {
      const method = "comment";
      const scope = scopeOf(CAPABILITY, method, options);
      const requestId = requestIdOf(CAPABILITY, method, options);
      return kernel.withLock(input.reviewId, () => {
        const state = stateOf(method, scope, input.reviewId);
        if (state.status === "closed") {
          throw reject(CAPABILITY, method, "review_closed", "The review is closed.");
        }
        checkTarget(method, state, input.target);
        const round = roundForNewInput(state);
        const commentId = deps.localIds.next("cmt");
        const by = actorOf(scope.context);
        commitOrThrow(method, {
          threadId: scope.threadId,
          turnId: scope.turnId,
          key: commitKey("comment", input.reviewId, requestId),
          fingerprint: toJson({ target: input.target, body: input.body }),
          events: [
            {
              kind: "artifact.review_commented",
              payload: toJson({
                reviewId: input.reviewId,
                round,
                commentId,
                target: input.target,
                body: input.body,
                by: by === "model" ? "group" : by,
              }),
            },
          ],
        });
        const after = stateOf(method, scope, input.reviewId);
        const stored = after.comments.find(
          (comment) => comment.body === input.body && comment.round === round,
        );
        const view: CommentView = {
          commentId: stored?.commentId ?? commentId,
          target: input.target,
          body: input.body,
          round,
          deliveredRound: null,
        };
        return Promise.resolve(view);
      });
    },

    async submit(input, options) {
      const method = "submit";
      const scope = scopeOf(CAPABILITY, method, options);
      requestIdOf(CAPABILITY, method, options);
      const result = await kernel.withLock(input.reviewId, () =>
        submitInner(scope.threadId, input.reviewId, {
          approveRemaining: input.approveRemaining === true,
          ...(input.deliverAs === undefined ? {} : { deliverAs: input.deliverAs }),
          by: actorOf(scope.context),
          turnId: scope.turnId,
          signal: scope.signal,
        }),
      );
      if (result.ok) return result.value;
      throw submitRejection(method, result.error);
    },

    close(input, options) {
      const method = "close";
      const scope = scopeOf(CAPABILITY, method, options);
      const requestId = requestIdOf(CAPABILITY, method, options);
      return kernel.withLock(input.reviewId, () => {
        const state = stateOf(method, scope, input.reviewId);
        if (state.status !== "closed") {
          commitOrThrow(method, {
            threadId: scope.threadId,
            turnId: scope.turnId,
            key: commitKey("close", input.reviewId, requestId),
            fingerprint: { reason: input.reason },
            events: [
              {
                kind: "artifact.review_closed",
                payload: { reviewId: input.reviewId, reason: input.reason },
              },
            ],
          });
        }
        return Promise.resolve(viewOf(stateOf(method, scope, input.reviewId), scope.threadId));
      });
    },
  };

  function firstOpened(
    firstSeq: number,
    lastSeq: number,
    threadId: ThreadId,
  ): ReviewOpenedPayload | undefined {
    const read = deps.session.feed.read(
      firstSeq - 1,
      lastSeq,
      { threadIds: [threadId], kindPrefixes: ["artifact.review_opened"] },
      lastSeq - firstSeq + 1,
      lastSeq - firstSeq + 1,
    );
    if (!read.ok) return undefined;
    const first = read.value.events[0];
    if (first === undefined) return undefined;
    const payload = parse(ReviewOpenedPayloadSchema, first.payload);
    return payload.ok ? payload.value : undefined;
  }

  function decide(
    method: "approve" | "reject",
    input: { readonly reviewId: string; readonly hunks: readonly string[] | "all" },
    options: Parameters<Api["approve"]>[1],
    decision: "approved" | "rejected",
  ): Promise<ReviewView> {
    const scope = scopeOf(CAPABILITY, method, options);
    const requestId = requestIdOf(CAPABILITY, method, options);
    return kernel.withLock(input.reviewId, () => {
      const state = stateOf(method, scope, input.reviewId);
      if (state.status === "closed") {
        throw reject(CAPABILITY, method, "review_closed", "The review is closed.");
      }
      const known = allHunks(state);
      const selected =
        input.hunks === "all"
          ? known.filter((hunk) => decision === "rejected" || hunk.applied !== "reverted")
          : input.hunks.map((id) => {
              const hunk = known.find((candidate) => candidate.hunkId === id);
              if (hunk === undefined) {
                throw reject(CAPABILITY, method, "hunk_unknown", `The review has no hunk ${id}.`);
              }
              return hunk;
            });
      if (decision === "approved" && selected.some((hunk) => hunk.applied === "reverted")) {
        throw reject(
          CAPABILITY,
          method,
          "invalid_input",
          "A reverted hunk cannot be approved again.",
        );
      }
      const by = actorOf(scope.context);
      commitOrThrow(method, {
        threadId: scope.threadId,
        turnId: scope.turnId,
        key: commitKey("decide", input.reviewId, requestId),
        fingerprint: toJson({ decision, hunks: input.hunks }),
        events: [
          {
            kind: "artifact.review_decided",
            payload: toJson({
              reviewId: input.reviewId,
              round: roundForNewInput(state),
              decisions: selected.map((hunk) => ({ hunkId: hunk.hunkId, decision })),
              by,
            }),
          },
        ],
      });
      return Promise.resolve(viewOf(stateOf(method, scope, input.reviewId), scope.threadId));
    });
  }

  /** 줄 세운 안에서 제출한다. spec §4.2.6 */
  async function submitInner(
    threadId: ThreadId,
    reviewId: string,
    options: SubmitOptions,
  ): Promise<Result<SubmitOutput, SubmitFailure>> {
    const load = (): Result<ReviewState, SubmitFailure> => {
      const loaded = kernel.load(threadId, reviewId);
      if (!loaded.ok) return err({ kind: "storage", cause: loaded.error });
      return loaded.value === undefined ? err({ kind: "not_found" }) : ok(loaded.value);
    };
    const write = (
      key: string,
      fingerprint: JsonValue,
      kind: EventKind,
      payload: JsonValue,
    ): SubmitFailure | undefined => {
      const committed = kernel.commit({
        threadId,
        turnId: options.turnId,
        key,
        fingerprint,
        events: [{ kind, payload }],
      });
      if (committed.ok) return undefined;
      return committed.error.kind === "rejected"
        ? { kind: "storage", cause: { kind: "row_invalid", where: committed.error.code } }
        : { kind: "storage", cause: committed.error };
    };

    let current = load();
    if (!current.ok) return current;
    let state = current.value;
    if (state.status === "closed") return err({ kind: "review_closed" });
    if (state.status === "submitted") {
      // 제출 뒤 새 입력이 없다: 이미 확정한 라운드이므로 다시 하지 않는다
      return ok({ review: viewOf(state, threadId), applied: [], delivery: null });
    }
    const round = state.round;
    const pending = allHunks(state).filter((hunk) => hunk.decision === "pending");
    if (pending.length > 0 && !options.approveRemaining) return err({ kind: "decisions_pending" });
    if (pending.length > 0) {
      const failed = write(
        commitKey("rest", reviewId, String(round)),
        { round, remaining: pending.map((hunk) => hunk.hunkId) },
        "artifact.review_decided",
        toJson({
          reviewId,
          round,
          decisions: pending.map((hunk) => ({ hunkId: hunk.hunkId, decision: "approved" })),
          by: options.by,
        }),
      );
      if (failed !== undefined) return err(failed);
      current = load();
      if (!current.ok) return current;
      state = current.value;
    }

    const applied = await applyRejections(kernel, threadId, state, options.signal);
    if (!("outcomes" in applied)) return err(applied);
    const outcomes: ApplyOutcome[] = applied.outcomes;
    if (outcomes.length > 0) {
      const failed = write(
        commitKey("applied", reviewId, String(round)),
        { round, outcomes: toJson(outcomes) },
        "artifact.review_applied",
        toJson({ reviewId, round, outcomes }),
      );
      if (failed !== undefined) return err(failed);
      current = load();
      if (!current.ok) return current;
      state = current.value;
    }

    // 코멘트의 hunk가 앞 라운드에서 결정됐어도 경로를 찾을 수 있게 모든 hunk를 싣는다. 이번 라운드가 아닌 hunk는 pending으로 두어 줄에 나오지 않게 한다
    const roundHunks = state.files.map((file) => ({
      path: file.path,
      hunks: file.hunks.map((hunk) =>
        hunk.decidedRound === round
          ? { hunkId: hunk.hunkId, decision: hunk.decision, applied: hunk.applied }
          : { hunkId: hunk.hunkId, decision: "pending" as const, applied: "none" as const },
      ),
    }));
    const undelivered = state.comments.filter((comment) => comment.deliveredRound === null);
    const nothingToTell =
      undelivered.length === 0 &&
      roundHunks.every((file) => file.hunks.every((hunk) => hunk.decision !== "rejected"));
    let delivery: SubmitOutput["delivery"] = null;
    let deliveryRecord: {
      requestId: string;
      when: "steer" | "followUp" | "next";
      commentIds: string[];
    } | null = null;
    if (!nothingToTell && deps.queue !== undefined) {
      const when = options.deliverAs ?? state.deliverAs;
      const requestId = `review:${reviewId}:r${String(round)}`;
      const posted = await deps.queue.enqueue({
        threadId,
        requestId,
        when,
        item: {
          kind: "user",
          content: renderDelivery({
            reviewId,
            round,
            files: roundHunks,
            comments: undelivered.map((comment) => ({
              target: comment.target,
              body: comment.body,
            })),
          }),
        },
      });
      if (!posted.ok)
        return err({ kind: "storage", cause: { kind: "io", code: posted.error.kind } });
      delivery = { requestId, when, duplicate: posted.value.duplicate };
      deliveryRecord = {
        requestId,
        when,
        commentIds: undelivered.map((comment) => comment.commentId),
      };
    }
    const failed = write(
      commitKey("submitted", reviewId, String(round)),
      { round },
      "artifact.review_submitted",
      toJson({ reviewId, round, delivery: deliveryRecord }),
    );
    if (failed !== undefined) return err(failed);
    current = load();
    if (!current.ok) return current;
    return ok({ review: viewOf(current.value, threadId), applied: outcomes, delivery });
  }

  return {
    api,
    kernel,
    submitUnlocked: (threadId, reviewId, options) => submitInner(threadId, reviewId, options),
  };
}

/** JSON으로 보낼 수 있는 값을 `JsonValue`로 확인한다. 우리가 만든 값이라 항상 JSON이다 */
function toJson(value: unknown): JsonValue {
  return toJsonValue(value) ?? null;
}
