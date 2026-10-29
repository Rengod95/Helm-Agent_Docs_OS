import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  ArtifactIdSchema,
  ArtifactsReviews,
  ArtifactsReviewsKey,
  ChangeSourceSchema,
  CommentTargetSchema,
  HunkDecisionSchema,
  HunkIdSchema,
  ReviewIdSchema,
  ReviewViewSchema,
  toJsonSchema,
  validateCapability,
} from "../../src/capabilities/index.ts";
import { ReviewAnswerSchema } from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OPEN = ArtifactsReviews.service.methods.open;

describe("artifacts.reviews definition", () => {
  test("validates with no issues, warnings included", () => {
    expect(validateCapability(ArtifactsReviews)).toEqual([]);
  });

  test("the key carries the capability id and version", () => {
    expect(ArtifactsReviewsKey).toEqual({ capability: "artifacts.reviews", version: "1.0.0" });
  });

  test("the only model tool is review_request and it calls open", () => {
    expect(ArtifactsReviews.tools.map((t) => t.name)).toEqual(["review_request"]);
    expect(ArtifactsReviews.tools[0].method).toBe("open");
  });

  test("toInput maps empty parameters to a turn source", () => {
    const tool = ArtifactsReviews.tools[0];
    const input = tool.toInput?.({});
    expect(input).toEqual({ changes: { type: "turn" } });
    expect(parse(OPEN.input, input).ok).toBe(true);
  });

  test("toInput maps tool call ids and title", () => {
    const tool = ArtifactsReviews.tools[0];
    const input = tool.toInput?.({ toolCallIds: ["a"], title: "t" });
    expect(input).toEqual({ changes: { type: "toolCalls", toolCallIds: ["a"] }, title: "t" });
    expect(parse(OPEN.input, input).ok).toBe(true);
  });

  test("open declares source_unsupported as a non-retryable error", () => {
    expect(Object.keys(OPEN.errors ?? {}).toSorted()).toEqual([
      "diff_unparsable",
      "no_changes",
      "review_too_large",
      "source_unsupported",
    ]);
    expect(OPEN.errors?.source_unsupported?.retryable).toBe(false);
  });

  test("mutating methods declare idempotent and get is read only", () => {
    const methods = ArtifactsReviews.service.methods;
    expect(methods.get.readOnly).toBe(true);
    for (const name of ["open", "approve", "reject", "comment", "submit", "close"] as const) {
      expect(methods[name].idempotent).toBe(true);
    }
  });
});

describe("artifacts.reviews schemas", () => {
  test("the four change sources parse and an empty toolCalls list does not", () => {
    const sources = [
      { type: "turn" },
      { type: "turn", turnId: rawId("trn", 1) },
      { type: "toolCalls", toolCallIds: ["a"] },
      { type: "checkpoint", checkpointId: rawId("ckp", 1) },
      { type: "patch", patch: "--- a\n+++ b" },
    ];
    for (const source of sources) expect(parse(ChangeSourceSchema, source).ok).toBe(true);
    expect(parse(ChangeSourceSchema, { type: "toolCalls", toolCallIds: [] }).ok).toBe(false);
  });

  test("hunk ids accept f<n>h<n> and reject other strings", () => {
    expect(parse(HunkIdSchema, "f0h1").ok).toBe(true);
    expect(parse(HunkIdSchema, "x").ok).toBe(false);
  });

  test("artifact and review ids use the art and rvw local prefixes", () => {
    expect(parse(ArtifactIdSchema, `art_${ULID}`).ok).toBe(true);
    expect(parse(ArtifactIdSchema, `rvw_${ULID}`).ok).toBe(false);
    expect(parse(ReviewIdSchema, `rvw_${ULID}`).ok).toBe(true);
    expect(parse(ReviewIdSchema, `art_${ULID}`).ok).toBe(false);
  });

  test("review view accepts a minimal value and rejects an unknown status", () => {
    const view = {
      reviewId: `rvw_${ULID}`,
      threadId: rawId("thr", 1),
      artifactId: `art_${ULID}`,
      title: "t",
      status: "open",
      round: 1,
      files: [],
      comments: [],
    };
    expect(parse(ReviewViewSchema, view).ok).toBe(true);
    expect(parse(ReviewViewSchema, { ...view, status: "bogus" }).ok).toBe(false);
  });

  test("hunk decision and comment target keep the approval record shape", () => {
    const answer = ReviewAnswerSchema.properties.decisions.items.properties.decision;
    const target = ReviewAnswerSchema.properties.comments.items.properties.target;
    expect(toJsonSchema(HunkDecisionSchema)).toEqual(toJsonSchema(answer));
    expect(toJsonSchema(CommentTargetSchema)).toEqual(toJsonSchema(target));
  });
});
