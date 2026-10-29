import { afterEach, expect, test } from "bun:test";
import type { EventsBatchParams } from "@xeon/contracts/wire";
import { exitCodeOfTurn } from "../src/commands/chat.ts";
import { collapseOps, splitBatchAt } from "../src/commands/chat-session.ts";
import { EXIT } from "../src/exit-codes.ts";
import type { RenderOp } from "../src/render/model.ts";
import { CTRL_C_WINDOW_MS } from "../src/signals.ts";
import { handlerFailedChunk, materialize, turnCompleted, userItem } from "./support/events.ts";
import { createHarness, type Harness, type HarnessOptions } from "./support/harness.ts";
import { itemId, threadId, turnId } from "./support/ids.ts";
import { scriptedInput } from "./support/script.ts";

function batch(from: number, count: number): EventsBatchParams {
  const events = Array.from({ length: count }, (_, index) =>
    materialize(userItem(turnId(1), index + 1, "x"), {
      seq: from + index + 1,
      id: from + index + 1,
      thread: threadId(1),
    }),
  );
  return { sub: "s1", from, to: from + count, events, caughtUp: true };
}

test("a batch entirely before the boundary is folded and one entirely after is not", () => {
  const before = batch(0, 3);
  expect(splitBatchAt(before, 5)).toEqual([{ batch: before, collapsed: true }]);
  const after = batch(5, 2);
  expect(splitBatchAt(after, 5)).toEqual([{ batch: after, collapsed: false }]);
});

test("a batch that crosses the boundary is cut in two continuous parts", () => {
  const crossing = batch(2, 6);
  const [first, second] = splitBatchAt(crossing, 5);
  expect(first?.collapsed).toBe(true);
  expect(first?.batch).toMatchObject({ from: 2, to: 5 });
  expect(first?.batch.events.map((event) => event.seq)).toEqual([3, 4, 5]);
  expect(second?.collapsed).toBe(false);
  expect(second?.batch).toMatchObject({ from: 5, to: 8 });
  expect(second?.batch.events.map((event) => event.seq)).toEqual([6, 7, 8]);
});

test("a folded history keeps user text and the assistant text without thinking", () => {
  const ops: RenderOp[] = [
    { kind: "user", itemId: itemId(1), text: "q" },
    {
      kind: "toolCall",
      view: { itemId: itemId(2), toolCallId: "c", toolName: "ls", argsSummary: "" },
    },
    { kind: "assistant", itemId: itemId(3), markdown: "a", thinking: "why" },
    { kind: "assistant", itemId: itemId(4), markdown: "", thinking: "only thinking" },
    { kind: "notice", text: "n" },
  ];
  expect(collapseOps(ops)).toEqual([
    { kind: "user", itemId: itemId(1), text: "q" },
    { kind: "assistant", itemId: itemId(3), markdown: "a", thinking: null },
  ]);
});

test("turn ends map to 0, 130 and 1", () => {
  expect(exitCodeOfTurn({ status: "completed", error: null })).toBe(0);
  expect(exitCodeOfTurn({ status: "interrupted", error: null })).toBe(130);
  expect(exitCodeOfTurn({ status: "failed", error: "x" })).toBe(1);
});

test("the ctrl+c window is two seconds", () => {
  expect(CTRL_C_WINDOW_MS).toBe(2000);
});

// ── 알림 그리기(M3-22, HS-80·HS-82): 가짜 서버가 보낸 알림이 대화 화면의 notice 줄이 된다 ──────

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const DELIVERED_AT = "2026-01-05T00:00:00.000Z";

function failure(consecutive: number): Record<string, unknown> {
  return {
    owner: "ext:acme-notes",
    point: "tool.before",
    result: "throw",
    message: "boom",
    consecutive,
  };
}

/** 턴 하나 동안 알림 네 건을 보낸 뒤 턴을 끝낸다. 둘째 줄은 묶음에서 빠지고, 다른 thread의 실패도 빠진다 */
function noticeScenario(options: Omit<HarnessOptions, "server"> = {}): Harness {
  const h = createHarness({
    ...options,
    server: {
      onTurn: (context) => {
        const { server } = context;
        server.chunk(
          handlerFailedChunk({ thread: context.threadId, n: 0, afterSeq: 0, payload: failure(1) }),
        );
        server.chunk(
          handlerFailedChunk({ thread: context.threadId, n: 1, afterSeq: 0, payload: failure(2) }),
        );
        server.chunk(
          handlerFailedChunk({ thread: threadId(9), n: 2, afterSeq: 0, payload: failure(1) }),
        );
        server.notifyDelivered({
          threadId: context.threadId,
          notice: {
            kind: "completed",
            title: "작업이 끝났다",
            body: null,
            seq: 1,
            sourceType: "dialog.notified",
          },
          deliveredAt: DELIVERED_AT,
        });
        server.notifyDelivered({
          threadId: threadId(9),
          notice: {
            kind: "error",
            title: "턴이 실패했다",
            body: "timeout",
            seq: 2,
            sourceType: "dialog.notified",
          },
          deliveredAt: DELIVERED_AT,
        });
        server.commit(context.threadId, [turnCompleted(context.turnId)]);
      },
    },
  });
  harnesses.push(h);
  return h;
}

const NOTICE_LINES = [
  "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): boom",
  "[완료] 작업이 끝났다",
  "[오류] 턴이 실패했다 (다른 대화)",
  "timeout",
  "",
].join("\n");

test("a print run draws only this thread's first handler failure, and no delivered notice", async () => {
  const h = noticeScenario();
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): boom\n");
});

test("an interactive session draws the failure and the delivered notices in arrival order", async () => {
  const input = scriptedInput(["go", "/quit"]);
  const h = noticeScenario({
    terminal: { stdinIsTty: true, stdoutIsTty: true, columns: 80 },
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
  });
  expect(await h.run(["chat"])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain(NOTICE_LINES);
});

test("--json draws no notice lines, and the notifications still pass through as raw JSON lines", async () => {
  const h = noticeScenario();
  expect(await h.run(["chat", "-p", "hello", "--json"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("");
  expect(h.stdoutText()).not.toContain("핸들러가 실패했다");
  expect(h.stdoutText()).toContain('"method":"notify.delivered"');
  expect(h.stdoutText()).toContain('"kind":"scope.handler_failed"');
});
