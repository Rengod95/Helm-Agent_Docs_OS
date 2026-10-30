import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { renderDelivery } from "../src/reviews/deliver.ts";
import type { DeliveryInput } from "../src/reviews/types.ts";

describe("renderDelivery", () => {
  test("writes the whole template: reverted, conflicted, kept, approved count and comments", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_01",
      round: 2,
      files: [
        {
          path: "src/a.ts",
          hunks: [
            { hunkId: "f0h0", decision: "approved", applied: "none" },
            { hunkId: "f0h1", decision: "rejected", applied: "reverted" },
            { hunkId: "f0h2", decision: "approved", applied: "none" },
            { hunkId: "f0h3", decision: "rejected", applied: "reverted" },
          ],
        },
        {
          path: "src/b.ts",
          hunks: [
            { hunkId: "f1h0", decision: "rejected", applied: "conflict" },
            { hunkId: "f1h1", decision: "approved", applied: "none" },
            { hunkId: "f1h2", decision: "approved", applied: "none" },
            { hunkId: "f1h3", decision: "approved", applied: "none" },
          ],
        },
        {
          path: "src/c.ts",
          hunks: [{ hunkId: "f2h0", decision: "rejected", applied: "none" }],
        },
      ],
      comments: [
        {
          target: { type: "hunk", hunkId: "f0h2", line: { side: "new", number: 41 } },
          body: "이 조건은 null도 걸러야 한다.",
        },
        { target: { type: "review" }, body: "테스트를 함께 고쳐 달라." },
      ],
    };

    expect(renderDelivery(input)).toBe(
      [
        "[review rvw_01 round 2]",
        "거절하고 되돌림: src/a.ts f0h1, f0h3",
        "되돌리지 못함(충돌): src/b.ts f1h0",
        "거절했으나 되돌리지 않음: src/c.ts f2h0",
        "승인: 나머지 5개 hunk",
        "",
        "코멘트:",
        "- src/a.ts f0h2 new 41행: 이 조건은 null도 걸러야 한다.",
        "- 리뷰 전체: 테스트를 함께 고쳐 달라.",
      ].join("\n"),
    );
  });

  test("a file comment and an old-side line comment; continuation lines are indented", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_02",
      round: 1,
      files: [
        {
          path: "src/a.ts",
          hunks: [
            { hunkId: "f0h0", decision: "approved", applied: "none" },
            { hunkId: "f0h1", decision: "rejected", applied: "reverted" },
          ],
        },
      ],
      comments: [
        { target: { type: "file", path: "src/a.ts" }, body: "첫 줄\n둘째 줄" },
        {
          target: { type: "hunk", hunkId: "f0h0", line: { side: "old", number: 3 } },
          body: "이 줄 앞에\n주석.",
        },
      ],
    };

    expect(renderDelivery(input)).toBe(
      [
        "[review rvw_02 round 1]",
        "거절하고 되돌림: src/a.ts f0h1",
        "승인: 나머지 1개 hunk",
        "",
        "코멘트:",
        "- src/a.ts: 첫 줄",
        "  둘째 줄",
        "- src/a.ts f0h0 old 3행: 이 줄 앞에",
        "  주석.",
      ].join("\n"),
    );
  });

  test("no reject line: the approval line says all hunks; no comments, no comment block", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_03",
      round: 1,
      files: [
        {
          path: "src/a.ts",
          hunks: [
            { hunkId: "f0h0", decision: "approved", applied: "none" },
            { hunkId: "f0h1", decision: "approved", applied: "none" },
          ],
        },
        {
          path: "src/b.ts",
          hunks: [{ hunkId: "f1h0", decision: "approved", applied: "none" }],
        },
      ],
      comments: [],
    };

    expect(renderDelivery(input)).toBe("[review rvw_03 round 1]\n승인: 모든 hunk 3개");
  });

  test("zero approved hunks omits the approval line", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_04",
      round: 3,
      files: [
        {
          path: "src/a.ts",
          hunks: [{ hunkId: "f0h0", decision: "rejected", applied: "reverted" }],
        },
      ],
      comments: [],
    };

    expect(renderDelivery(input)).toBe("[review rvw_04 round 3]\n거절하고 되돌림: src/a.ts f0h0");
  });

  test("comments with no reject line: the path of a hunk comment comes from its file index", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_06",
      round: 1,
      files: [
        {
          path: "src/a.ts",
          hunks: [{ hunkId: "f0h0", decision: "approved", applied: "none" }],
        },
        {
          path: "src/b.ts",
          hunks: [{ hunkId: "f1h0", decision: "approved", applied: "none" }],
        },
      ],
      comments: [
        {
          target: { type: "hunk", hunkId: "f1h0", line: { side: "new", number: 7 } },
          body: "확인",
        },
        { target: { type: "review" }, body: "좋아요." },
      ],
    };

    expect(renderDelivery(input)).toBe(
      [
        "[review rvw_06 round 1]",
        "승인: 모든 hunk 2개",
        "",
        "코멘트:",
        "- src/b.ts f1h0 new 7행: 확인",
        "- 리뷰 전체: 좋아요.",
      ].join("\n"),
    );
  });

  test("a comment on a hunk that is not in the input is a bug, not a result", () => {
    const input: DeliveryInput = {
      reviewId: "rvw_07",
      round: 1,
      files: [
        {
          path: "src/a.ts",
          hunks: [{ hunkId: "f0h0", decision: "approved", applied: "none" }],
        },
      ],
      comments: [{ target: { type: "hunk", hunkId: "f5h0" }, body: "없는 hunk" }],
    };

    expect(() => renderDelivery(input)).toThrow(Bug);
  });
});
