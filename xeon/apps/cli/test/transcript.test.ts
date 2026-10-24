import { expect, test } from "bun:test";
import type { EventsBatchParams, EventWire, StreamChunkParams } from "@xeon/contracts/wire";
import {
  applyBatch,
  applyChunk,
  initialTranscript,
  type RenderOp,
  type TranscriptState,
} from "../src/render/model.ts";
import { restoreRedactions } from "../src/render/transcript.ts";
import {
  assistantItem,
  effectIntent,
  effectResult,
  materialize,
  textChunk,
  toolResultItem,
  turnCompleted,
  userItem,
  type EventDraft,
} from "./support/events.ts";
import { itemId, storeId, threadId, turnId } from "./support/ids.ts";

const STORE = storeId(1);
const THREAD = threadId(1);
const TURN = turnId(1);

function events(from: number, drafts: readonly EventDraft[]): EventWire[] {
  return drafts.map((draft, index) =>
    materialize(draft, { seq: from + index + 1, id: from + index + 100, thread: THREAD }),
  );
}

function batch(from: number, drafts: readonly EventDraft[], sub = "s1"): EventsBatchParams {
  const list = events(from, drafts);
  return { sub, from, to: from + list.length, events: list, caughtUp: true };
}

function applied(
  state: TranscriptState,
  params: EventsBatchParams,
): { readonly state: TranscriptState; readonly ops: readonly RenderOp[] } {
  const result = applyBatch(state, params, STORE);
  if (!result.ok) throw new Error(`gap ${result.error.expectedFrom} ${result.error.got}`);
  return result.value;
}

const START = initialTranscript({ storeId: STORE, seq: 0 });

test("a batch becomes ops in order and moves the position to the batch end", () => {
  const { state, ops } = applied(
    START,
    batch(0, [
      userItem(TURN, 1, "hi"),
      assistantItem(TURN, 2, { text: "hello", thinking: "hmm" }),
      turnCompleted(TURN),
    ]),
  );
  expect(ops).toEqual([
    { kind: "user", itemId: itemId(1), text: "hi" },
    { kind: "assistant", itemId: itemId(2), markdown: "hello", thinking: "hmm" },
    { kind: "turnEnd", status: "completed", error: null },
  ]);
  expect(state.position).toEqual({ storeId: STORE, seq: 3 });
});

test("the same seq twice is ignored the second time (AC10)", () => {
  const first = batch(0, [userItem(TURN, 1, "hi")]);
  const once = applied(START, first);
  const twice = applied(once.state, first);
  expect(twice.ops).toEqual([]);
  expect(twice.state.position).toEqual({ storeId: STORE, seq: 1 });
});

test("an overlapping batch only adds the events after the position", () => {
  const drafts = [userItem(TURN, 1, "a"), assistantItem(TURN, 2, { text: "b" })];
  const once = applied(START, batch(0, drafts.slice(0, 1)));
  const overlap = applied(once.state, batch(0, drafts));
  expect(overlap.ops).toEqual([
    { kind: "assistant", itemId: itemId(2), markdown: "b", thinking: null },
  ]);
});

test("a hole between the position and the batch start is a gap (AC10)", () => {
  const result = applyBatch(START, batch(5, [userItem(TURN, 1, "x")]), STORE);
  expect(result).toEqual({ ok: false, error: { kind: "gap", expectedFrom: 0, got: 5 } });
});

test("a state without a position takes the first batch's from as the baseline", () => {
  const { state } = applied(initialTranscript(null), batch(7, [userItem(TURN, 1, "x")]));
  expect(state.position).toEqual({ storeId: STORE, seq: 8 });
});

test("an empty batch only advances the position", () => {
  const { state, ops } = applied(START, { sub: "s1", from: 0, to: 4, events: [], caughtUp: true });
  expect(ops).toEqual([]);
  expect(state.position?.seq).toBe(4);
});

test("tool calls and results are drawn with the details renderer or the first 20 lines", () => {
  const long = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n");
  const { ops } = applied(
    START,
    batch(0, [
      effectIntent(TURN, {
        effect: 1,
        item: 3,
        toolCallId: "c1",
        toolName: "read",
        args: { path: "a.txt" },
      }),
      toolResultItem(TURN, {
        item: 4,
        effect: 1,
        toolCallId: "c1",
        toolName: "read",
        text: long,
      }),
    ]),
  );
  expect(ops[0]).toEqual({
    kind: "toolCall",
    view: {
      itemId: itemId(3),
      toolCallId: "c1",
      toolName: "read",
      argsSummary: '{"path":"a.txt"}',
    },
  });
  const result = ops[1];
  if (result?.kind !== "toolResult") throw new Error("expected a tool result");
  expect(result.view.lines).toHaveLength(21);
  expect(result.view.lines[0]).toBe("line 1");
  expect(result.view.lines[20]).toBe("… (5줄 더 있음)");
  expect(result.view.synthesized).toBe(false);
});

test("a synthesized result is marked, even when effect.result comes later in the batch", () => {
  const { ops } = applied(
    START,
    batch(0, [
      toolResultItem(TURN, {
        item: 4,
        effect: 1,
        toolCallId: "c1",
        toolName: "read",
        text: "interrupted",
        isError: true,
      }),
      effectResult(TURN, { effect: 1, synthesized: true, resultItem: 4 }),
    ]),
  );
  const result = ops[0];
  if (result?.kind !== "toolResult") throw new Error("expected a tool result");
  expect(result.view).toMatchObject({ synthesized: true, isError: true });
});

test("a long argument summary is cut to 120 characters on one line", () => {
  const { ops } = applied(
    START,
    batch(0, [
      effectIntent(TURN, {
        effect: 1,
        item: 3,
        toolCallId: "c1",
        toolName: "bash",
        args: { command: `echo ${"x".repeat(300)}\nsecond line` },
      }),
    ]),
  );
  const call = ops[0];
  if (call?.kind !== "toolCall") throw new Error("expected a tool call");
  expect(call.view.argsSummary.length).toBeLessThanOrEqual(120);
  expect(call.view.argsSummary).not.toContain("\n");
});

function customItem(display: boolean): EventDraft {
  return {
    kind: "item.recorded",
    turnId: TURN,
    payload: {
      item: {
        itemId: itemId(9),
        status: "completed",
        kind: "custom",
        message: {
          role: "custom",
          customType: "grp.helm.note.shown",
          content: "extension says hi",
          display,
          details: null,
          timestamp: 1,
        },
      },
    },
  };
}

test("custom items show only when display is true", () => {
  expect(applied(START, batch(0, [customItem(true)])).ops).toEqual([
    {
      kind: "custom",
      itemId: itemId(9),
      customType: "grp.helm.note.shown",
      text: "extension says hi",
    },
  ]);
  expect(applied(START, batch(0, [customItem(false)])).ops).toEqual([]);
});

test("kinds that are not drawn produce no ops", () => {
  const quiet: EventDraft[] = [
    { kind: "step.started", turnId: TURN, payload: { stepIndex: 0 } },
    { kind: "lease.acquired", turnId: null, payload: {} },
    { kind: "x.some-ext.area.thing", turnId: null, payload: { anything: true } },
  ];
  expect(applied(START, batch(0, quiet)).ops).toEqual([]);
});

test("an unreadable payload becomes a one-line notice, not an exception", () => {
  const { ops } = applied(START, batch(0, [{ kind: "turn.completed", turnId: TURN, payload: {} }]));
  expect(ops).toEqual([{ kind: "notice", text: "이벤트 turn.completed의 모양을 읽지 못했다" }]);
});

test("settings.changed shows the key and scope but never the value", () => {
  const { ops } = applied(
    START,
    batch(0, [
      {
        kind: "settings.changed",
        turnId: null,
        payload: { key: "l4.cli.theme", scope: "user", value: "secret://api-key" },
      },
    ]),
  );
  expect(ops).toEqual([{ kind: "notice", text: "설정이 바뀌었다: l4.cli.theme (user)" }]);
});

test("redacted fields are shown as [redacted] and never restored", () => {
  const redacted: EventDraft = {
    kind: "item.recorded",
    turnId: TURN,
    payload: {
      item: {
        itemId: itemId(1),
        status: "completed",
        kind: "user",
        // 호스트가 content를 지웠다: 값은 이벤트 어디에도 없다
        message: { role: "user", timestamp: 1 },
        requestId: null,
      },
    },
    redactions: ["/item/message/content"],
  };
  const { ops } = applied(START, batch(0, [redacted]));
  expect(ops).toEqual([{ kind: "user", itemId: itemId(1), text: "[redacted]" }]);
});

test("restoreRedactions fills array elements and nested objects without touching the input", () => {
  const input = { a: [{ text: "x" }, null], b: { c: null } };
  const restored = restoreRedactions(input, ["/a/1", "/b/c"]);
  expect(restored).toEqual({ a: [{ text: "x" }, "[redacted]"], b: { c: "[redacted]" } });
  expect(input).toEqual({ a: [{ text: "x" }, null], b: { c: null } });
});

test("approval.requested and approval.resolved draw and track the pending set", () => {
  const requested: EventDraft = {
    kind: "approval.requested",
    turnId: TURN,
    payload: {
      origin: {
        threadId: THREAD,
        turnId: TURN,
        stepId: null,
        toolCallId: "c1",
        caller: "model",
      },
      requestKey: "k",
      title: "bash 실행",
      body: {
        kind: "question",
        question: {
          questions: [
            { id: "q1", text: "계속할까?", options: [], multiSelect: false, allowFreeText: true },
          ],
        },
      },
      remember: ["once"],
      surfaceThreadId: THREAD,
      requestedAt: 1,
    },
  };
  const first = applied(START, batch(0, [requested]));
  const view = first.ops[0];
  if (view?.kind !== "approval") throw new Error("expected an approval op");
  expect(view.view).toMatchObject({ title: "bash 실행", body: ["계속할까?"], allowsAnswer: true });
  expect(first.state.pendingApprovals.has(view.view.approvalId)).toBe(true);
  const resolved: EventDraft = {
    kind: "approval.resolved",
    turnId: TURN,
    payload: {
      approvalId: view.view.approvalId,
      decision: "deny",
      answer: null,
      remember: "once",
      requestedRemember: null,
      resolvedBy: "user",
    },
  };
  const second = applied(first.state, batch(1, [resolved]));
  expect(second.ops).toEqual([{ kind: "approvalResolved", approvalId: view.view.approvalId }]);
  expect(second.state.pendingApprovals.size).toBe(0);
});

function chunk(n: number, afterSeq: number, delta: string, item = 2): StreamChunkParams {
  return { event: textChunk({ turn: TURN, item, n, afterSeq, delta }) };
}

test("text chunks accumulate into one progress line per item", () => {
  const one = applyChunk(START, chunk(0, 0, "Hel"));
  expect(one.ops).toEqual([{ kind: "progress", itemId: itemId(2), text: "Hel" }]);
  const two = applyChunk(one.state, chunk(1, 0, "lo"));
  expect(two.ops).toEqual([{ kind: "progress", itemId: itemId(2), text: "Hello" }]);
  expect(two.state.openItems.has(itemId(2))).toBe(true);
});

test("the durable record of an item clears its progress line and drops later chunks", () => {
  const streaming = applyChunk(START, chunk(0, 0, "Hello"));
  const done = applied(streaming.state, batch(0, [assistantItem(TURN, 2, { text: "Hello" })]));
  expect(done.ops[0]).toEqual({ kind: "clearProgress", itemId: itemId(2) });
  expect(done.state.openItems.size).toBe(0);
  const late = applyChunk(done.state, chunk(1, 1, " late"));
  expect(late.ops).toEqual([]);
});

test("a chunk whose afterSeq is ahead of the position waits until the position reaches it", () => {
  const early = applyChunk(START, chunk(0, 1, "later"));
  expect(early.ops).toEqual([]);
  expect(early.state.deferredChunks).toHaveLength(1);
  const caught = applied(early.state, batch(0, [userItem(TURN, 1, "q")]));
  expect(caught.ops).toEqual([
    { kind: "user", itemId: itemId(1), text: "q" },
    { kind: "progress", itemId: itemId(2), text: "later" },
  ]);
  expect(caught.state.deferredChunks).toHaveLength(0);
});

test("a chunk still ahead after a batch stays deferred", () => {
  const early = applyChunk(START, chunk(0, 5, "far"));
  const caught = applied(early.state, batch(0, [userItem(TURN, 1, "q")]));
  expect(caught.state.deferredChunks).toHaveLength(1);
});

test("duplicate and older chunk numbers of the same turn are dropped", () => {
  const first = applyChunk(START, chunk(3, 0, "a"));
  const dup = applyChunk(first.state, chunk(3, 0, "a"));
  expect(dup.ops).toEqual([]);
  const old = applyChunk(first.state, chunk(1, 0, "z"));
  expect(old.ops).toEqual([]);
});

test("tool progress replaces the line with the first non-empty line", () => {
  const progress: StreamChunkParams = {
    event: {
      ...textChunk({ turn: TURN, item: 3, n: 0, afterSeq: 0, delta: "" }),
      payload: {
        itemId: itemId(3),
        update: {
          kind: "tool_progress",
          partialResult: { content: [{ type: "text", text: "\n  scanning files\nmore" }] },
        },
      },
    },
  };
  expect(applyChunk(START, progress).ops).toEqual([
    { kind: "progress", itemId: itemId(3), text: "· scanning files" },
  ]);
});

test("chunks of kinds other than item.updated are ignored", () => {
  const other: StreamChunkParams = {
    event: {
      ...textChunk({ turn: TURN, item: 3, n: 0, afterSeq: 0, delta: "" }),
      kind: "turn.updated",
    },
  };
  expect(applyChunk(START, other).ops).toEqual([]);
});

test("applying a batch never changes the previous state object", () => {
  const before = JSON.stringify([...START.openItems]);
  applied(START, batch(0, [userItem(TURN, 1, "x")]));
  expect(START.position).toEqual({ storeId: STORE, seq: 0 });
  expect(JSON.stringify([...START.openItems])).toBe(before);
});
