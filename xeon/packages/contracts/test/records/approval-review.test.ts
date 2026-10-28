import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  ApprovalAnswerSchema,
  ApprovalRequestedPayloadSchema,
  ReviewAnswerSchema,
} from "../../src/records/index.ts";
import type { ApprovalKind } from "../../src/services/index.ts";
import type { Equal, Expect } from "../types/expect.ts";
import { PAYLOAD_FIXTURES } from "./fixtures/payloads.ts";

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

const review = {
  kind: "review",
  review: {
    reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "refactor loader",
    round: 1,
    files: [
      { path: "src/a.ts", change: "modified", binary: false, hunks: 2 },
      { path: "logo.png", change: "added", binary: true, hunks: 0 },
    ],
  },
};

/** ADR-0018 §3 2: 승인 kind는 tool, plan, question, review다 */
export type KindsAreFour = Expect<Equal<ApprovalKind, "tool" | "plan" | "question" | "review">>;

const bad = (patch: Record<string, unknown>): Record<string, unknown> => ({
  kind: "review",
  review: { ...review.review, ...patch },
});

describe("approval kind review (ADR-0018, M3-REQ-09)", () => {
  const base = PAYLOAD_FIXTURES["approval.requested"];

  test("approval.requested accepts a review body and keeps it", () => {
    const parsed = parse(ApprovalRequestedPayloadSchema, { ...base, body: review });
    const body: unknown = parsed.ok ? parsed.value.body : undefined;
    expect(body).toEqual(review);
  });

  test("rejects malformed review bodies", () => {
    for (const patch of [
      { reviewId: "rvw_short" },
      { reviewId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      { artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      { round: 0 },
      { files: [{ path: "", change: "modified", binary: false, hunks: 1 }] },
      { files: [{ path: "a", change: "copied", binary: false, hunks: 1 }] },
      { files: [{ path: "a", change: "added", binary: false, hunks: -1 }] },
      { extra: true },
    ]) {
      expect(accepts(ApprovalRequestedPayloadSchema, { ...base, body: bad(patch) })).toBe(false);
    }
    expect(
      accepts(ApprovalRequestedPayloadSchema, { ...base, body: { kind: "review", plan: {} } }),
    ).toBe(false);
  });

  const answer = {
    decisions: [
      { hunkId: "f0h0", decision: "approved" },
      { hunkId: "f1h2", decision: "rejected" },
    ],
    comments: [
      { target: { type: "hunk", hunkId: "f1h2", line: { side: "new", number: 4 } }, body: "why" },
      { target: { type: "file", path: "src/a.ts" }, body: "rename" },
      { target: { type: "review" }, body: "overall" },
    ],
    submit: true,
    approveRemaining: false,
  };

  test("ReviewAnswer parses and is part of ApprovalAnswer", () => {
    expect(accepts(ReviewAnswerSchema, answer)).toBe(true);
    expect(accepts(ApprovalAnswerSchema, answer)).toBe(true);
    expect(accepts(ReviewAnswerSchema, { decisions: [], comments: [], submit: false })).toBe(true);
  });

  test("ReviewAnswer rejects bad decisions, targets, empty comment bodies and missing submit", () => {
    expect(
      accepts(ReviewAnswerSchema, {
        ...answer,
        decisions: [{ hunkId: "h1", decision: "approved" }],
      }),
    ).toBe(false);
    expect(
      accepts(ReviewAnswerSchema, {
        ...answer,
        decisions: [{ hunkId: "f0h0", decision: "maybe" }],
      }),
    ).toBe(false);
    expect(
      accepts(ReviewAnswerSchema, {
        ...answer,
        comments: [{ target: { type: "line" }, body: "x" }],
      }),
    ).toBe(false);
    expect(
      accepts(ReviewAnswerSchema, {
        ...answer,
        comments: [{ target: { type: "review" }, body: "" }],
      }),
    ).toBe(false);
    expect(accepts(ReviewAnswerSchema, { decisions: [], comments: [] })).toBe(false);
  });
});
