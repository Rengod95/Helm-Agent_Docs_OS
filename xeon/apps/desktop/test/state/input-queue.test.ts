import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectQueuedInputs } from "../../src/state/engine/selectors.ts";
import {
  INITIAL_MIRROR,
  QUEUED_INPUT_CAP,
  type EngineMirror,
} from "../../src/state/engine/state.ts";
import { STORE, SUB, evt, thr } from "./helpers.ts";

// 대기 입력(`input.queued`·`input.placed`·`input.withdrawn`)의 디코드와 거울의 대기 입력 목록(입력창 위 칩).
// 입력 id는 `input.queued` 이벤트 id다. 배치되거나 거둬지면 목록에서 빠진다. thread마다 `QUEUED_INPUT_CAP`개까지 둔다.

const T: ThreadId = thr(1);
const OTHER: ThreadId = thr(2);
const AT = "2026-11-04T00:00:00.000Z";

function wire(seq: number, kind: EventWire["kind"], payload: unknown, threadId = T): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

type QueuedOver = {
  readonly mode?: string;
  readonly requestId?: string;
  readonly content?: unknown;
  readonly source?: unknown;
};

/** 사용자 글 입력의 `input.queued` 사건. 덮어쓸 항목만 바꾼다 */
function queuedEvent(seq: number, over: QueuedOver = {}, threadId: ThreadId = T): EventWire {
  return wire(
    seq,
    "input.queued",
    {
      mode: over.mode ?? "steer",
      item: { kind: "user", content: over.content ?? "이 파일도 봐 줘" },
      requestId: over.requestId ?? `req-${String(seq)}`,
      source: over.source ?? { type: "user", via: "interactive" },
    },
    threadId,
  );
}

const queued = (seq: number, over: QueuedOver = {}, threadId: ThreadId = T): DurableFact =>
  decodeDurable(queuedEvent(seq, over, threadId));
const placed = (seq: number, inputSeq: number): DurableFact =>
  decodeDurable(wire(seq, "input.placed", { inputId: evt(inputSeq), itemId: itemIdOf(seq) }));
const withdrawn = (seq: number, inputSeq: number, reason = "user"): DurableFact =>
  decodeDurable(wire(seq, "input.withdrawn", { inputId: evt(inputSeq), reason }));

/** 배치 사건의 item id는 형식만 맞으면 된다. 거울은 읽지 않는다 */
function itemIdOf(n: number): string {
  return `itm_${"0".repeat(22)}${String(n).padStart(4, "0")}`;
}

function run(facts: readonly DurableFact[]): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: SUB, storeId: STORE, start: 0, live: true, from: "head" },
    { type: "batch", sub: SUB, from: 0, to: facts.length, caughtUp: true, facts: [...facts] },
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

describe("input.* events: decode", () => {
  test("a queued user text keeps its mode, request key, source type, and text; the input id is the event id", () => {
    expect(decodeDurable(queuedEvent(1, { mode: "steer", requestId: "req-a" }))).toEqual({
      type: "input.queued",
      seq: 1,
      eventId: evt(1),
      threadId: T,
      turnId: null,
      at: AT,
      input: {
        mode: "steer",
        requestId: "req-a",
        sourceType: "user",
        preview: { kind: "text", text: "이 파일도 봐 줘" },
      },
    });
  });

  test("the chip text is the masked text: the host's marks are applied, and marks that do not fit hide the input", () => {
    const text = "key sk-probe-123 now";
    const start = text.indexOf("sk-probe-123");
    const marked: EventWire = {
      ...queuedEvent(1, { content: text }),
      mask: [
        {
          pointer: "/item/content",
          len: text.length,
          ranges: [{ start, end: start + 12, label: "token" }],
        },
      ],
    };
    const fact = decodeDurable(marked);
    expect(fact.type === "input.queued" ? fact.input.preview : null).toEqual({
      kind: "text",
      text: "key [REDACTED:token] now",
    });
    const stale: EventWire = {
      ...queuedEvent(2, { content: text }),
      mask: [{ pointer: "/item/content", len: 3, ranges: [] }],
    };
    const hidden = decodeDurable(stale);
    expect(hidden.type === "input.queued" ? hidden.input.preview : null).toEqual({
      kind: "text",
      text: "[REDACTED:unverified]",
    });
    const broken: EventWire = {
      ...queuedEvent(3),
      mask: [{ pointer: "/item", len: 1, ranges: [] }],
    };
    expect(decodeDurable(broken).type).toBe("unreadable");
  });

  test("a long text keeps its first 120 characters and ends with an ellipsis; surrounding spaces go", () => {
    const fact = queued(1, { content: `  ${"가".repeat(130)}  ` });
    expect(fact.type === "input.queued" ? fact.input.preview : null).toEqual({
      kind: "text",
      text: `${"가".repeat(120)}…`,
    });
    const exact = queued(2, { content: "나".repeat(120) });
    expect(exact.type === "input.queued" ? exact.input.preview : null).toEqual({
      kind: "text",
      text: "나".repeat(120),
    });
  });

  test("an item without text is labeled: images, context, or empty", () => {
    const image = decodeDurable(
      wire(1, "input.queued", {
        mode: "followUp",
        item: {
          kind: "user",
          content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
        },
        requestId: "img",
        source: { type: "user", via: "rpc" },
      }),
    );
    expect(image).toMatchObject({
      type: "input.queued",
      input: {
        mode: "followUp",
        sourceType: "user",
        preview: { kind: "label", labelKey: "image" },
      },
    });
    const context = decodeDurable(
      wire(2, "input.queued", {
        mode: "next",
        item: { kind: "context", customType: "note", content: "맥락", display: false, details: {} },
        requestId: "ctx",
        source: { type: "extension", scopeId: "grp:helm" },
      }),
    );
    expect(context).toMatchObject({
      type: "input.queued",
      input: {
        mode: "next",
        sourceType: "extension",
        preview: { kind: "label", labelKey: "context" },
      },
    });
    expect(queued(3, { content: "   " })).toMatchObject({
      input: { preview: { kind: "label", labelKey: "empty" } },
    });
  });

  test("a text part list reads its text parts only", () => {
    const fact = decodeDurable(
      wire(1, "input.queued", {
        mode: "steer",
        item: {
          kind: "user",
          content: [
            { type: "text", text: "앞" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
            { type: "text", text: "뒤" },
          ],
        },
        requestId: "mix",
        source: { type: "user", via: "interactive" },
      }),
    );
    expect(fact).toMatchObject({ input: { preview: { kind: "text", text: "앞뒤" } } });
  });

  test("placed and withdrawn carry the queued event id; a bad payload is unreadable", () => {
    expect(
      decodeDurable(wire(2, "input.placed", { inputId: evt(1), itemId: itemIdOf(9) })),
    ).toEqual({
      type: "input.placed",
      seq: 2,
      eventId: evt(2),
      threadId: T,
      turnId: null,
      at: AT,
      inputId: evt(1),
    });
    expect(withdrawn(3, 1, "aborted")).toMatchObject({ type: "input.withdrawn", inputId: evt(1) });
    expect(
      decodeDurable(wire(4, "input.withdrawn", { inputId: "not-an-event", reason: "user" })).type,
    ).toBe("unreadable");
    expect(queued(5, { mode: "later" }).type).toBe("unreadable");
  });
});

describe("queued inputs in the mirror", () => {
  test("a queued input is one record for its thread, keyed by the event id", () => {
    const state = run([queued(1, { requestId: "r1" })]);
    expect(state.queuedInputs).toEqual([
      {
        inputId: evt(1),
        threadId: T,
        mode: "steer",
        requestId: "r1",
        sourceType: "user",
        preview: { kind: "text", text: "이 파일도 봐 줘" },
      },
    ]);
  });

  test("a placed input leaves the list, and so does a withdrawn one; other inputs stay in order", () => {
    const state = run([queued(1), queued(2), queued(3), placed(4, 1), withdrawn(5, 3)]);
    expect(state.queuedInputs.map((r) => r.inputId)).toEqual([evt(2)]);
  });

  test("an event for an input the mirror never saw leaves the list as it is", () => {
    const before = run([queued(1)]);
    const after = reduceMirror(before, {
      type: "batch",
      sub: SUB,
      from: 1,
      to: 3,
      caughtUp: true,
      facts: [placed(2, 99), withdrawn(3, 98)],
    }).state;
    expect(after.queuedInputs).toBe(before.queuedInputs);
  });

  test("the same queued event (same input id) is recorded once even at a later seq", () => {
    const state = run([queued(1)]);
    const again = reduceMirror(state, {
      type: "batch",
      sub: SUB,
      from: 1,
      to: 2,
      caughtUp: true,
      facts: [{ ...queued(1), seq: 2 }],
    }).state;
    expect(again.queuedInputs.map((r) => r.inputId)).toEqual([evt(1)]);
  });

  test("each thread keeps at most QUEUED_INPUT_CAP inputs, and the oldest of that thread goes first", () => {
    const facts: DurableFact[] = [];
    for (let n = 1; n <= QUEUED_INPUT_CAP + 1; n += 1)
      facts.push(queued(n, { requestId: `r${String(n)}` }));
    facts.push(queued(QUEUED_INPUT_CAP + 2, { requestId: "other" }, OTHER));
    const state = run(facts);
    const mine = state.queuedInputs.filter((r) => r.threadId === T).map((r) => r.requestId);
    expect(mine.length).toBe(QUEUED_INPUT_CAP);
    expect(mine[0]).toBe("r2");
    expect(mine.at(-1)).toBe(`r${String(QUEUED_INPUT_CAP + 1)}`);
    expect(state.queuedInputs.filter((r) => r.threadId === OTHER).map((r) => r.requestId)).toEqual([
      "other",
    ]);
  });

  test("delegation and schedule inputs are kept with their source type, for the screen to filter", () => {
    const state = run([
      queued(1, { source: { type: "delegation", childThreadId: thr(7) } }),
      queued(2, { source: { type: "schedule", timerId: "t1" } }),
    ]);
    expect(state.queuedInputs.map((r) => r.sourceType)).toEqual(["delegation", "schedule"]);
  });

  test("the selector gives one thread's inputs, and none without a thread", () => {
    const state = run([queued(1), queued(2, {}, OTHER)]);
    expect(selectQueuedInputs(state, T).map((r) => r.inputId)).toEqual([evt(1)]);
    expect(selectQueuedInputs(state, null)).toEqual([]);
  });

  test("a head subscription starts the mirror again, so the queued inputs are cleared with the rest", () => {
    const state = run([queued(1)]);
    const reset = reduceMirror(state, {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 0,
      live: true,
      from: "head",
    }).state;
    expect(reset.queuedInputs).toEqual([]);
  });
});
