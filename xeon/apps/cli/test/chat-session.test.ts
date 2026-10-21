import { expect, test } from "bun:test";
import type { EventsBatchParams } from "@xeon/contracts/wire";
import { exitCodeOfTurn } from "../src/commands/chat.ts";
import { collapseOps, splitBatchAt } from "../src/commands/chat-session.ts";
import type { RenderOp } from "../src/render/model.ts";
import { CTRL_C_WINDOW_MS } from "../src/signals.ts";
import { materialize, userItem } from "./support/events.ts";
import { itemId, threadId, turnId } from "./support/ids.ts";

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
