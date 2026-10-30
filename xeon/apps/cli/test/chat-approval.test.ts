import { afterEach, expect, test } from "bun:test";
import { ReviewAnswerSchema } from "@xeon/contracts/records";
import { parse } from "@xeon/contracts";
import { EXIT } from "../src/exit-codes.ts";
import {
  approvalRequested,
  approvalResolved,
  assistantItem,
  turnCompleted,
} from "./support/events.ts";
import type { FakeServer, TurnContext } from "./support/fake-server.ts";
import { createHarness, waitFor, type Harness } from "./support/harness.ts";
import { BLOCK, scriptedInput, type Reply } from "./support/script.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

interface Scenario {
  readonly h: Harness;
  readonly responds: Record<string, unknown>[];
  readonly input: ReturnType<typeof scriptedInput>;
}

/**
 * 한 턴짜리 대화형 시나리오: 첫 입력 "go" → 서버가 승인 요청을 낸다 → 사람이 답한다 → 서버가 승인을 닫고 턴을 끝낸다.
 * replies에는 "go" 이후의 답을 적는다. 마지막에 /quit를 자동으로 더한다
 */
function scenario(options: {
  readonly body?: unknown;
  readonly remember?: readonly ("once" | "thread" | "always")[];
  readonly replies: readonly Reply[];
  /** approval.respond가 돌려줄 applied */
  readonly applied?: boolean;
  /** 답을 받으면 서버가 승인을 닫고 턴을 끝낸다(기본 참) */
  readonly closeOnRespond?: boolean;
  /** 서버가 열린 승인을 먼저 닫는 시험: 요청 직후 호출된다 */
  readonly afterRequest?: (server: FakeServer, context: TurnContext, approvalId: string) => void;
}): Scenario {
  const responds: Record<string, unknown>[] = [];
  const input = scriptedInput(["go", ...options.replies, "/quit"]);
  const open: { context?: TurnContext; approvalId?: string } = {};
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      handlers: {
        "approval.respond": (params, server) => {
          responds.push({ ...params });
          const { context, approvalId } = open;
          if (
            context !== undefined &&
            approvalId !== undefined &&
            options.closeOnRespond !== false
          ) {
            server.commit(context.threadId, [
              approvalResolved(context.turnId, approvalId),
              assistantItem(context.turnId, 3, { text: "done" }),
              turnCompleted(context.turnId),
            ]);
          }
          return { applied: options.applied ?? true };
        },
      },
      onTurn: (context) => {
        const [event] = context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId, {
            ...(options.body === undefined ? {} : { body: options.body }),
            ...(options.remember === undefined ? {} : { remember: options.remember }),
          }),
        ]);
        if (event === undefined) return;
        open.context = context;
        open.approvalId = event.id;
        options.afterRequest?.(context.server, context, event.id);
      },
    },
  });
  harnesses.push(h);
  return { h, responds, input };
}

test("a tool approval is asked with the remember choices the request allows; y allows once", async () => {
  const s = scenario({ replies: ["y"] });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.input.prompts[1]).toBe(
    "[y] 이번만 허용  [t] 이 세션 동안 허용  [a] 항상 허용  [n] 거부 > ",
  );
  expect(s.responds).toHaveLength(1);
  expect(s.responds[0]).toMatchObject({ decision: "allow", remember: "once" });
  expect(s.h.stdoutText()).toContain("done");
});

test("t and a pick the wider remember scopes only when the request offers them", async () => {
  const thread = scenario({ replies: ["t"] });
  await thread.h.run(["chat"]);
  expect(thread.responds[0]).toMatchObject({ decision: "allow", remember: "thread" });

  const always = scenario({ replies: ["a"] });
  await always.h.run(["chat"]);
  expect(always.responds[0]).toMatchObject({ decision: "allow", remember: "always" });

  // once만 허용하는 요청에서는 a가 선택지가 아니다: 다시 묻는다
  const narrow = scenario({ remember: ["once"], replies: ["a", "y"] });
  await narrow.h.run(["chat"]);
  expect(narrow.input.prompts[1]).toBe("[y] 이번만 허용  [n] 거부 > ");
  expect(narrow.h.stdoutText()).toContain("y, t, a, n 중 하나를 입력한다");
  expect(narrow.responds).toHaveLength(1);
  expect(narrow.responds[0]).toMatchObject({ decision: "allow", remember: "once" });
});

test("n asks for a reason and sends it as the deny answer; an empty reason sends a plain deny", async () => {
  const withReason = scenario({ replies: ["n", "너무 위험하다"] });
  await withReason.h.run(["chat"]);
  expect(withReason.responds[0]).toMatchObject({
    decision: "deny",
    answer: { feedback: "너무 위험하다" },
  });

  const plain = scenario({ replies: ["n", ""] });
  await plain.h.run(["chat"]);
  expect(plain.responds[0]).toEqual({ approvalId: expect.any(String), decision: "deny" });
});

test("a plan approval can pick the next mode and add a note", async () => {
  const body = {
    kind: "plan",
    plan: { plan: "1. 읽는다\n2. 고친다", planRef: null, nextModes: ["default", "acceptEdits"] },
  };
  const s = scenario({ body, replies: ["y", "2", "진행해"] });
  await s.h.run(["chat"]);
  expect(s.responds[0]).toMatchObject({
    decision: "allow",
    answer: { mode: "acceptEdits", note: "진행해" },
  });
  expect(s.h.stderrText()).toContain("1. 읽는다");

  const denied = scenario({ body, replies: ["n", "다시 계획해"] });
  await denied.h.run(["chat"]);
  expect(denied.responds[0]).toMatchObject({
    decision: "deny",
    answer: { feedback: "다시 계획해" },
  });
});

test("a plan approval with no modes and no note allows with an empty answer", async () => {
  const body = { kind: "plan", plan: { plan: "계획", planRef: null, nextModes: [] } };
  const s = scenario({ body, replies: ["y", ""] });
  await s.h.run(["chat"]);
  expect(s.responds[0]).toMatchObject({ decision: "allow", answer: {} });
});

const REVIEW_BODY = {
  kind: "review",
  review: {
    reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "refactor loader",
    round: 1,
    files: [{ path: "src/a.ts", change: "modified", binary: false, hunks: 2 }],
  },
};

test("a review approval shows the file summary; y approves every hunk and submits as a ReviewAnswer", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["y"] });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.input.prompts[1]).toBe("[y] 모두 승인  [r] 일부 거절  [c] 수정 요청  [n] 모두 거절 > ");
  expect(s.h.stderrText()).toContain("modified src/a.ts (hunk 2)");
  expect(s.responds).toHaveLength(1);
  const answer = {
    decisions: [],
    comments: [],
    submit: true,
    approveRemaining: true,
  };
  expect(s.responds[0]).toEqual({ approvalId: expect.any(String), decision: "answer", answer });
  expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
});

test("c on a review sends the feedback as a review-level comment without submitting; empty feedback asks again", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["c", "", "c", "로더 이름을 바꿔 줘"] });
  await s.h.run(["chat"]);
  expect(s.h.stdoutText()).toContain("수정 요청에는 내용이 필요하다");
  expect(s.responds).toHaveLength(1);
  const answer = {
    decisions: [],
    comments: [{ target: { type: "review" }, body: "로더 이름을 바꿔 줘" }],
    submit: false,
  };
  expect(s.responds[0]).toEqual({ approvalId: expect.any(String), decision: "answer", answer });
  expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
});

test("n on a review asks for a reason and sends a deny answer; an unknown key asks again", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["x", "n", "범위가 넓다"] });
  await s.h.run(["chat"]);
  expect(s.h.stdoutText()).toContain("y, r, c, n 중 하나를 입력한다");
  expect(s.responds).toHaveLength(1);
  expect(s.responds[0]).toMatchObject({ decision: "deny", answer: { feedback: "범위가 넓다" } });
});

test("r asks which hunks to reject; the chosen hunk is rejected, the rest approved, and it is submitted", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["r", "f0h1"] });
  await s.h.run(["chat"]);
  expect(s.input.prompts[2]).toBe("거절할 hunk (쉼표로 구분, 예 f0h1,f1h0 / all = 전부) > ");
  expect(s.responds).toHaveLength(1);
  const answer = {
    decisions: [{ hunkId: "f0h1", decision: "rejected" }],
    comments: [],
    submit: true,
    approveRemaining: true,
  };
  expect(s.responds[0]).toEqual({ approvalId: expect.any(String), decision: "answer", answer });
  expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
});

test("r with all rejects every hunk the card shows", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["r", "all"] });
  await s.h.run(["chat"]);
  const answer = {
    decisions: [
      { hunkId: "f0h0", decision: "rejected" },
      { hunkId: "f0h1", decision: "rejected" },
    ],
    comments: [],
    submit: true,
    approveRemaining: true,
  };
  expect(s.responds).toEqual([{ approvalId: expect.any(String), decision: "answer", answer }]);
  expect(parse(ReviewAnswerSchema, answer).ok).toBe(true);
});

test("r with an unknown hunk id says so and asks the review prompt again", async () => {
  const s = scenario({ body: REVIEW_BODY, replies: ["r", "f0h9", "r", "f0h0"] });
  await s.h.run(["chat"]);
  expect(s.h.stdoutText()).toContain("알 수 없는 hunk: f0h9");
  expect(s.input.prompts[3]).toBe("[y] 모두 승인  [r] 일부 거절  [c] 수정 요청  [n] 모두 거절 > ");
  expect(s.responds).toHaveLength(1);
  expect(s.responds[0]).toMatchObject({
    decision: "answer",
    answer: { decisions: [{ hunkId: "f0h0", decision: "rejected" }], submit: true },
  });
});

test("r with an empty hunk list says so and asks again; a file list with no hunks refuses r", async () => {
  const empty = scenario({ body: REVIEW_BODY, replies: ["r", "", "y"] });
  await empty.h.run(["chat"]);
  expect(empty.h.stdoutText()).toContain("알 수 없는 hunk: (비어 있음)");
  expect(empty.responds[0]).toMatchObject({
    decision: "answer",
    answer: { decisions: [], submit: true, approveRemaining: true },
  });

  const none = {
    kind: "review",
    review: {
      ...REVIEW_BODY.review,
      files: [{ path: "a.bin", change: "modified", binary: true, hunks: 0 }],
    },
  };
  const refused = scenario({ body: none, replies: ["r", "y"] });
  await refused.h.run(["chat"]);
  expect(refused.h.stdoutText()).toContain("거절할 hunk가 없다");
  expect(refused.input.prompts[2]).toBe(
    "[y] 모두 승인  [r] 일부 거절  [c] 수정 요청  [n] 모두 거절 > ",
  );
  expect(refused.responds[0]).toMatchObject({ decision: "answer", answer: { submit: true } });
});

// 카드가 내는 검토 답(y, r, c)은 모두 ReviewAnswer 모양이어야 한다. n은 거부 답이라 대상이 아니다
for (const replies of [["y"], ["r", "f0h1"], ["r", "all"], ["r", "f0h0,f0h1"], ["c", "고쳐 줘"]]) {
  test(`the review answer for ${replies.join(" then ")} passes ReviewAnswerSchema`, async () => {
    const s = scenario({ body: REVIEW_BODY, replies });
    await s.h.run(["chat"]);
    expect(s.responds).toHaveLength(1);
    expect(parse(ReviewAnswerSchema, s.responds[0]?.["answer"]).ok).toBe(true);
  });
}

const QUESTION_BODY = {
  kind: "question",
  question: {
    questions: [
      {
        id: "q1",
        header: "범위",
        text: "어느 쪽으로 할까?",
        options: [
          { id: "a", label: "작게", recommended: true },
          { id: "b", label: "크게", description: "시간이 더 든다" },
        ],
        multiSelect: false,
        allowFreeText: true,
      },
      {
        id: "q2",
        text: "함께 할 것",
        options: [
          { id: "x", label: "테스트" },
          { id: "y", label: "문서" },
        ],
        multiSelect: true,
        allowFreeText: false,
      },
    ],
  },
};

test("a question approval is answered per question and sent as a QuestionAnswer", async () => {
  const s = scenario({ body: QUESTION_BODY, replies: ["2", "1,2"] });
  await s.h.run(["chat"]);
  expect(s.responds[0]).toMatchObject({
    decision: "answer",
    answer: { q1: { selected: ["b"] }, q2: { selected: ["x", "y"] } },
  });
  const shown = s.h.stdoutText();
  expect(shown).toContain("질문 1/2: [범위] 어느 쪽으로 할까?");
  expect(shown).toContain("1) 작게 (추천)");
  expect(shown).toContain("2) 크게 - 시간이 더 든다");
});

test("a question accepts free text when allowed, and re-asks on input it cannot read", async () => {
  const s = scenario({ body: QUESTION_BODY, replies: ["9", "직접 쓴 답", "3", "1"] });
  await s.h.run(["chat"]);
  expect(s.responds[0]).toMatchObject({
    decision: "answer",
    answer: { q1: { selected: [], text: "직접 쓴 답" }, q2: { selected: ["x"] } },
  });
  expect(s.h.stdoutText().match(/읽을 수 없는 입력이다/g)).toHaveLength(2);
});

test("/deny on a question denies the whole request", async () => {
  const s = scenario({ body: QUESTION_BODY, replies: ["/deny"] });
  await s.h.run(["chat"]);
  expect(s.responds[0]).toEqual({ approvalId: expect.any(String), decision: "deny" });
});

test("an approval another client answers first closes the open prompt", async () => {
  const s = scenario({
    replies: [BLOCK],
    closeOnRespond: false,
    afterRequest: (server, context, approvalId) => {
      // 사람이 아직 답하지 않았는데 다른 클라이언트가 먼저 승인을 닫고 턴을 끝낸다
      setTimeout(() => {
        server.commit(context.threadId, [
          approvalResolved(context.turnId, approvalId),
          assistantItem(context.turnId, 3, { text: "done elsewhere" }),
          turnCompleted(context.turnId),
        ]);
      }, 5);
    },
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.responds).toEqual([]);
  expect(s.h.stdoutText()).toContain("done elsewhere");
  expect(s.h.stdoutText()).toContain("다른 곳에서 이미 답한 승인이다");
});

test("a reply the host says it did not apply is announced as already answered", async () => {
  const s = scenario({ replies: ["y"], applied: false });
  await s.h.run(["chat"]);
  expect(s.h.stdoutText()).toContain("다른 곳에서 이미 답한 승인이다");
});

test("print mode answers every approval with deny and says so", async () => {
  const responds: Record<string, unknown>[] = [];
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        "approval.respond": (params) => (responds.push({ ...params }), { applied: true }),
      },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "run it"])).toBe(EXIT.ok);
  expect(responds).toEqual([{ approvalId: expect.any(String), decision: "deny" }]);
  expect(h.stderrText()).toContain('승인 요청 "bash 실행"에 비대화 모드라 거부로 답했다');
});

test("pending approvals are asked again when a session is resumed (approval.list)", async () => {
  const responds: Record<string, unknown>[] = [];
  const input = scriptedInput(["y", "/quit"]);
  const thread = (await import("./support/ids.ts")).threadId(1);
  const turn = (await import("./support/ids.ts")).turnId(1);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      knownThreads: [thread],
      handlers: {
        "approval.list": () => ({
          approvals: [
            {
              approvalId: "evt_00000000000000000000000077",
              seq: 2,
              request: approvalRequested(thread, turn).payload,
            },
          ],
          position: { storeId: "sto_00000000000000000000000001", seq: 2 },
        }),
        "approval.respond": (params) => (responds.push({ ...params }), { applied: true }),
      },
    },
  });
  harnesses.push(h);
  const run = h.run(["chat", "--resume", thread]);
  await waitFor(() => responds.length === 1);
  expect(await run).toBe(EXIT.ok);
  expect(responds[0]).toMatchObject({
    approvalId: "evt_00000000000000000000000077",
    decision: "allow",
    remember: "once",
  });
});

const PLAN_BODY = {
  kind: "plan",
  plan: { plan: "파일을 고친다", planRef: null, nextModes: [] },
};

/** 승인 알림 줄만 모은다. 요청 카드(`승인 요청: …`)는 텍스트 싱크가 따로 쓴다 */
function noticeLines(stderr: string): readonly string[] {
  return stderr.split("\n").filter((line) => line.startsWith('승인 요청 "'));
}

/** print 모드 한 턴: 승인 요청 하나를 내고 턴을 끝낸다. approval.respond 호출을 모은다 */
function printWithApproval(options: {
  readonly body?: unknown;
  readonly remember?: readonly ("once" | "thread" | "always")[];
  /** approval.respond가 적용하지 않은 것으로 답한다 */
  readonly notApplied?: boolean;
}): { readonly h: Harness; readonly responds: Record<string, unknown>[] } {
  const responds: Record<string, unknown>[] = [];
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        "approval.respond": (params) => {
          responds.push({ ...params });
          return options.notApplied === true
            ? { applied: false, reason: "already_resolved" }
            : { applied: true };
        },
      },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId, {
            ...(options.body === undefined ? {} : { body: options.body }),
            ...(options.remember === undefined ? {} : { remember: options.remember }),
          }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  return { h, responds };
}

test("--auto-approve answers a tool approval with allow once, without remember, and says so on stderr", async () => {
  const { h, responds } = printWithApproval({});
  expect(await h.run(["chat", "-p", "run it", "--auto-approve"])).toBe(EXIT.ok);
  expect(responds).toEqual([{ approvalId: expect.any(String), decision: "allow" }]);
  expect(responds[0]).not.toHaveProperty("remember");
  expect(noticeLines(h.stderrText())).toEqual([
    '승인 요청 "bash 실행"을 --auto-approve로 허용했다',
  ]);
});

test("--auto-approve says why an allow was not applied", async () => {
  const { h, responds } = printWithApproval({ notApplied: true });
  expect(await h.run(["chat", "-p", "run it", "--auto-approve"])).toBe(EXIT.ok);
  expect(responds).toHaveLength(1);
  expect(noticeLines(h.stderrText())).toEqual([
    '승인 요청 "bash 실행"을 --auto-approve로 허용하려 했으나 적용되지 않았다 (already_resolved)',
  ]);
});

test("--auto-approve still denies a question approval, with the same notice as the default", async () => {
  const { h, responds } = printWithApproval({ body: QUESTION_BODY, remember: ["once"] });
  expect(await h.run(["chat", "-p", "run it", "--auto-approve"])).toBe(EXIT.ok);
  expect(responds).toEqual([{ approvalId: expect.any(String), decision: "deny" }]);
  expect(noticeLines(h.stderrText())).toEqual([
    '승인 요청 "bash 실행"에 비대화 모드라 거부로 답했다',
  ]);
});

test("--auto-approve still denies a plan approval", async () => {
  const { h, responds } = printWithApproval({ body: PLAN_BODY, remember: ["once"] });
  expect(await h.run(["chat", "-p", "run it", "--auto-approve"])).toBe(EXIT.ok);
  expect(responds).toEqual([{ approvalId: expect.any(String), decision: "deny" }]);
  expect(noticeLines(h.stderrText())).toEqual([
    '승인 요청 "bash 실행"에 비대화 모드라 거부로 답했다',
  ]);
});
