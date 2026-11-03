import { describe, expect, test } from "bun:test";
import type { ReviewGetResult } from "@fresnel/contracts/wire";
import {
  APPROVE_ALL_ANSWER,
  addReviewComment,
  reviewAnswerOf,
  toggleHunkDecision,
  EMPTY_REVIEW_DRAFT,
} from "../../src/views/review-model.ts";
import { evt } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 변경 검토 명령(`commands.review`, `respondApproval`, `openReview`)을 가짜 엔진 위에서 끝까지 돌린다.
// wire params는 `toEqual`로 정확히 비교한다. 답의 값은 손으로 적은 기대 값이다(화면 조립 함수의 출력을 그대로 믿지 않는다).

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const REVIEW_ID = "rvw_01ABCDEFGHJKMNPQRSTVWXYZ00";

describe("review.get", () => {
  test("the reviewId goes out as the wire names it, and the hunk bodies come back as the wire value", async () => {
    const body: ReviewGetResult = {
      reviewId: REVIEW_ID,
      files: [
        {
          path: "src/cache.ts",
          hunks: [
            {
              hunkId: "f0h0",
              header: "@@ -10,2 +10,2 @@",
              oldStart: 10,
              newStart: 10,
              lines: [
                { kind: "del", text: "return entry.at + ttl < now" },
                { kind: "add", text: "return entry.atMs + ttlMs < now" },
              ],
            },
          ],
        },
      ],
    };
    const { app, params } = await liveApp({ results: { "review.get": body } });
    const read = await app.commands.review.get(REVIEW_ID);
    expect(paramsOf(params, "review.get")).toEqual([{ reviewId: REVIEW_ID }]);
    expect(read).toEqual({ ok: true, value: body });
    await app.stop();
  });

  test("a review the host does not know is a rejected command, not a value", async () => {
    const { app } = await liveApp({
      errors: {
        "review.get": {
          code: -32602,
          kind: "invalid_params",
          details: { issues: [{ path: "reviewId", message: "unknown review" }] },
        },
      },
    });
    expect(await app.commands.review.get(REVIEW_ID)).toEqual({
      ok: false,
      error: { kind: "rejected", code: -32602 },
    });
    await app.stop();
  });
});

describe("approval.respond from the review screen", () => {
  test("a submit with mixed decisions and comments sends the exact ReviewAnswer", async () => {
    const { app, params } = await liveApp({ results: { "approval.respond": { applied: true } } });
    const draft = addReviewComment(
      addReviewComment(
        toggleHunkDecision(
          toggleHunkDecision(EMPTY_REVIEW_DRAFT, "f0h0", "approved"),
          "f1h0",
          "rejected",
        ),
        "f0h1",
        "ms 단위 주석 필요",
      ),
      "f1h0",
      "log는 그대로 두세요",
    );
    await app.commands.respondApproval(evt(7), {
      decision: "answer",
      answer: reviewAnswerOf(["f0h0", "f0h1", "f1h0"], draft),
    });
    expect(paramsOf(params, "approval.respond")).toEqual([
      {
        approvalId: evt(7),
        decision: "answer",
        answer: {
          decisions: [
            { hunkId: "f0h0", decision: "approved" },
            { hunkId: "f1h0", decision: "rejected" },
          ],
          comments: [
            { target: { type: "hunk", hunkId: "f0h1" }, body: "ms 단위 주석 필요" },
            { target: { type: "hunk", hunkId: "f1h0" }, body: "log는 그대로 두세요" },
          ],
          submit: true,
          approveRemaining: false,
        },
      },
    ]);
    // 적용되면 표시는 "보내는 중"으로 남고, 대기열에서 빠지는 일은 approval.resolved가 한다
    expect(app.ui.read.getState().approvalSends[evt(7)]).toBe("sending");
    await app.stop();
  });

  test("approve-all and deny send the fixed answers, deny without an answer", async () => {
    const { app, params } = await liveApp({ results: { "approval.respond": { applied: true } } });
    await app.commands.respondApproval(evt(8), { decision: "answer", answer: APPROVE_ALL_ANSWER });
    await app.commands.respondApproval(evt(9), { decision: "deny" });
    expect(paramsOf(params, "approval.respond")).toEqual([
      {
        approvalId: evt(8),
        decision: "answer",
        answer: { decisions: [], comments: [], submit: true, approveRemaining: true },
      },
      { approvalId: evt(9), decision: "deny" },
    ]);
    await app.stop();
  });

  test("a response that finds the request already handled shows the closed state on that approval", async () => {
    const { app } = await liveApp({
      results: { "approval.respond": { applied: false, reason: "already_resolved" } },
    });
    await app.commands.respondApproval(evt(7), {
      decision: "answer",
      answer: APPROVE_ALL_ANSWER,
    });
    expect(app.ui.read.getState().approvalSends[evt(7)]).toBe("closed");
    await app.stop();
  });
});

describe("openReview", () => {
  test("the card's 검토 열기 sets the review target the screen follows", async () => {
    const { app } = await liveApp({});
    app.commands.openReview({ approvalId: evt(7), reviewId: REVIEW_ID });
    expect(app.ui.read.getState().reviewTarget).toEqual({
      approvalId: evt(7),
      reviewId: REVIEW_ID,
    });
    await app.stop();
  });
});
