import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EventKind,
  ReviewAppliedPayload,
  ReviewSubmittedPayload,
} from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import {
  INITIAL_MIRROR,
  REVIEW_RESULT_CAP,
  type EngineMirror,
} from "../../src/state/engine/state.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { STORE, SUB, evt, thr } from "./helpers.ts";

// 변경 검토 결과(`artifact.review_applied`·`artifact.review_submitted`)의 디코드와 거울의 기록(P-04 제출 결과 표).
// 기록은 리뷰마다 가장 최근 라운드 하나이고, 옛 라운드의 이벤트는 거울을 바꾸지 않는다.

const T: ThreadId = thr(1);
const REVIEW = "rvw_01ABCDEFGHJKMNPQRSTVWXYZ00";
const AT = "2026-11-04T00:00:00.000Z";

const CACHE_OUTCOME: ReviewAppliedPayload["outcomes"][number] = {
  path: "src/cache.ts",
  hunkIds: ["f0h2"],
  result: "reverted",
  method: "workspace_files",
};

function wire(seq: number, kind: EventKind, payload: unknown): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: T,
    turnId: null,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

const appliedFact = (seq: number, payload: ReviewAppliedPayload): DurableFact => ({
  type: "review.applied",
  seq,
  eventId: evt(seq),
  threadId: T,
  turnId: null,
  at: AT,
  payload,
});

const submittedFact = (seq: number, payload: ReviewSubmittedPayload): DurableFact => ({
  type: "review.submitted",
  seq,
  eventId: evt(seq),
  threadId: T,
  turnId: null,
  at: AT,
  payload,
});

function run(facts: readonly DurableFact[]): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: SUB, storeId: STORE, start: 0, live: true, from: "head" },
    { type: "batch", sub: SUB, from: 0, to: facts.length, caughtUp: true, facts: [...facts] },
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

describe("review result events: decode", () => {
  test("a valid review_applied carries its outcomes, and a bad result is unreadable", () => {
    const payload: ReviewAppliedPayload = { reviewId: REVIEW, round: 1, outcomes: [CACHE_OUTCOME] };
    expect(decodeDurable(wire(1, "artifact.review_applied", payload))).toMatchObject({
      type: "review.applied",
      payload,
    });
    const bad = wire(2, "artifact.review_applied", {
      reviewId: REVIEW,
      round: 1,
      outcomes: [{ ...CACHE_OUTCOME, result: "lost" }],
    });
    expect(decodeDurable(bad).type).toBe("unreadable");
  });

  test("a valid review_submitted carries the delivery, and a null delivery is valid too", () => {
    const delivery = { requestId: "review:r:r1", when: "followUp" as const, commentIds: [] };
    const withDelivery: ReviewSubmittedPayload = { reviewId: REVIEW, round: 1, delivery };
    const withoutDelivery: ReviewSubmittedPayload = { reviewId: REVIEW, round: 1, delivery: null };
    expect(decodeDurable(wire(3, "artifact.review_submitted", withDelivery))).toMatchObject({
      type: "review.submitted",
      payload: withDelivery,
    });
    expect(decodeDurable(wire(4, "artifact.review_submitted", withoutDelivery))).toMatchObject({
      type: "review.submitted",
      payload: withoutDelivery,
    });
  });
});

describe("review results in the mirror", () => {
  test("applied then submitted of one round form one record with both parts", () => {
    const delivery = { requestId: "review:r:r1", when: "followUp" as const, commentIds: [] };
    const state = run([
      appliedFact(1, { reviewId: REVIEW, round: 1, outcomes: [CACHE_OUTCOME] }),
      submittedFact(2, { reviewId: REVIEW, round: 1, delivery }),
    ]);
    expect(state.reviewResults).toEqual([
      { reviewId: REVIEW, round: 1, outcomes: [CACHE_OUTCOME], submitted: true, delivery },
    ]);
  });

  test("a submit with nothing to revert has no outcomes, and the record says it was submitted", () => {
    const state = run([submittedFact(1, { reviewId: REVIEW, round: 1, delivery: null })]);
    expect(state.reviewResults).toEqual([
      { reviewId: REVIEW, round: 1, outcomes: null, submitted: true, delivery: null },
    ]);
  });

  test("a newer round replaces the older record, and an older round's event after it changes nothing", () => {
    const delivery = { requestId: "review:r:r2", when: "steer" as const, commentIds: [] };
    const state = run([
      appliedFact(1, { reviewId: REVIEW, round: 1, outcomes: [CACHE_OUTCOME] }),
      submittedFact(2, { reviewId: REVIEW, round: 1, delivery: null }),
      submittedFact(3, { reviewId: REVIEW, round: 2, delivery }),
      appliedFact(4, { reviewId: REVIEW, round: 1, outcomes: [] }),
    ]);
    expect(state.reviewResults).toEqual([
      { reviewId: REVIEW, round: 2, outcomes: null, submitted: true, delivery },
    ]);
  });

  test("the record list keeps REVIEW_RESULT_CAP reviews and drops the oldest first", () => {
    const facts: DurableFact[] = [];
    for (let i = 0; i <= REVIEW_RESULT_CAP; i += 1) {
      const reviewId = `rvw_01ABCDEFGHJKMNPQRSTVWX${String(i).padStart(4, "0")}`;
      facts.push(submittedFact(i + 1, { reviewId, round: 1, delivery: null }));
    }
    const state = run(facts);
    expect(state.reviewResults).toHaveLength(REVIEW_RESULT_CAP);
    expect(state.reviewResults[0]?.reviewId).toBe(
      `rvw_01ABCDEFGHJKMNPQRSTVWX${String(1).padStart(4, "0")}`,
    );
  });
});
