import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { ApprovalId, TurnId } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import { createAnswerHandler } from "../src/reviews/answer.ts";
import { hunkStates } from "./support/assert.ts";
import { A_AFTER_EDIT, ONE_FILE_THREE_HUNKS } from "./support/fixtures.ts";
import { openReviews, type ReviewsHarness } from "./support/harness.ts";

setDefaultTimeout(20_000);

// L2.artifacts.spec §4.2.8: 강제 종료로 끊긴 검토 답(승인은 답했는데 적용·제출 기록이 없다)을 다음 시작 때 이어서 한다.
// 끊긴 상태는 "승인 요청과 해결 이벤트는 있고 artifact.review_applied/submitted는 없다"이다. 시험은 그 이벤트 목록을 만들어 이어하기에 넘긴다.

let opened: ReviewsHarness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

interface Interrupted {
  readonly h: ReviewsHarness;
  readonly reviewId: string;
  readonly approvalId: ApprovalId;
  /** 재시작 때 읽는 이벤트 목록: 승인 요청, 사람의 거절 답 */
  readonly events: readonly DurableEventEnvelope[];
}

/** 검토를 열고, 거절 답이 기록된 채 끊긴 상태를 만든다(답을 처리하는 핸들러는 부르지 않는다) */
async function interrupted(files: Readonly<Record<string, string>>): Promise<Interrupted> {
  const h = await openReviews(files);
  opened = h;
  const turn: TurnId = h.ids.next("trn");
  const view = await h.api.open(
    { changes: { type: "patch", patch: ONE_FILE_THREE_HUNKS } },
    h.opts(undefined, turn),
  );
  const [first] = h.approvals.snapshots;
  if (first === undefined) throw new Bug("the test expected a review approval request");
  const approvalId = first.approvalId;
  const before = await h.events();
  const lastSeq = before.reduce((max, event) => Math.max(max, event.seq), 0);
  const requested: DurableEventEnvelope = {
    id: approvalId,
    kind: "approval.requested",
    version: 1,
    threadId: h.threadId,
    turnId: null,
    stepId: null,
    recordedAt: 0,
    causationId: null,
    correlationId: null,
    payload: {
      origin: {
        threadId: h.threadId,
        turnId: turn,
        stepId: null,
        toolCallId: null,
        caller: "main",
      },
      requestKey: "review",
      title: view.title,
      body: {
        kind: "review",
        review: {
          reviewId: view.reviewId,
          artifactId: view.artifactId,
          title: view.title,
          round: 1,
          files: [],
        },
      },
      remember: [],
      surfaceThreadId: h.threadId,
      requestedAt: 0,
    },
    durable: true,
    seq: lastSeq + 1,
    parentId: null,
  };
  const resolved: DurableEventEnvelope = {
    ...h.resolvedEvent(approvalId, "deny", { feedback: "no" }),
    seq: lastSeq + 2,
  };
  return { h, reviewId: view.reviewId, approvalId, events: [...before, requested, resolved] };
}

test("an answer that has no applied record is resumed after a restart: the rejected hunks are reverted and the review is submitted", async () => {
  const { h, reviewId, events } = await interrupted({ "src/a.ts": A_AFTER_EDIT });
  const answers = createAnswerHandler(h.runtime, undefined);

  const resumed = await answers.recoverInterrupted(events);

  expect(resumed).toBe(1);
  expect(h.files.contents.get("src/a.ts")).toBe("const x = 1;\nconst y = 2;\nconst z = 3;\n");
  const view = await h.api.get({ reviewId }, h.opts());
  expect([view.status, view.round]).toEqual(["submitted", 1]);
  expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
    ["rejected", "reverted"],
    ["rejected", "reverted"],
    ["rejected", "reverted"],
  ]);
  expect((await h.events("artifact.review_applied")).length).toBe(1);
});

test("a file that changed while the engine was down is not overwritten and the user is told which hunks were not reverted", async () => {
  // 두 번째 hunk의 줄을 그사이 다른 값으로 바꿨다(다른 대화나 사람이 고친 경우와 같다)
  const changed = "const x = 10;\nconst y = 99;\nconst z = 30;\n";
  const { h, reviewId, events } = await interrupted({ "src/a.ts": changed });
  const answers = createAnswerHandler(h.runtime, undefined);

  await answers.recoverInterrupted(events);

  expect(h.files.contents.get("src/a.ts")).toBe("const x = 1;\nconst y = 99;\nconst z = 3;\n");
  const view = await h.api.get({ reviewId }, h.opts());
  expect(hunkStates(view).map((state) => state.slice(1))).toEqual([
    ["rejected", "reverted"],
    ["rejected", "conflict"],
    ["rejected", "reverted"],
  ]);
  expect(h.queue.posts.map((post) => post.item)).toEqual([
    {
      kind: "user",
      content: `[review ${reviewId} round 1]\n거절하고 되돌림: src/a.ts f0h0, f0h2\n되돌리지 못함(충돌): src/a.ts f0h1\n\n코멘트:\n- 리뷰 전체: no`,
    },
  ]);
});

test("a second start does nothing: the answer already has its applied and submitted records", async () => {
  const { h, events } = await interrupted({ "src/a.ts": A_AFTER_EDIT });
  const answers = createAnswerHandler(h.runtime, undefined);
  await answers.recoverInterrupted(events);
  const callsAfterFirst = h.files.calls.length;
  const postsAfterFirst = h.queue.posts.length;
  const recorded = await h.events();

  // 두 번째 시작이 읽는 목록: 위 이벤트에 첫 이어하기가 남긴 기록이 뒤에 붙는다
  const later = recorded.filter((event) => event.seq > (events.at(-1)?.seq ?? 0));
  const second = await answers.recoverInterrupted([...events, ...later]);

  expect(second).toBe(0);
  expect(h.files.calls.length).toBe(callsAfterFirst);
  expect(h.queue.posts.length).toBe(postsAfterFirst);
  expect(await h.events()).toEqual(recorded);
});

test("an answer that someone other than the user resolved is not resumed", async () => {
  const { h, events, approvalId } = await interrupted({ "src/a.ts": A_AFTER_EDIT });
  const answers = createAnswerHandler(h.runtime, undefined);
  const last = events.at(-1);
  if (last === undefined) throw new Bug("the test expected events");
  const expired = h.resolvedEvent(approvalId, "deny", { feedback: "no" }, "expired");
  const stamped: DurableEventEnvelope = { ...expired, seq: last.seq };

  const resumed = await answers.recoverInterrupted([...events.slice(0, -1), stamped]);

  expect(resumed).toBe(0);
  expect(h.files.calls).toEqual([]);
});
