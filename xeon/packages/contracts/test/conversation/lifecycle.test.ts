import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ITEM_TRANSITIONS,
  ItemRecordSchema,
  ItemStartedPayloadSchema,
  ItemUpdatedPayloadSchema,
  StepCompletedPayloadSchema,
  StepStartedPayloadSchema,
  StepUpdatedPayloadSchema,
  STEP_TRANSITIONS,
  THREAD_TRANSITIONS,
  ThreadClosedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TURN_TRANSITIONS,
  ToolCallItemSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  TurnUpdatedPayloadSchema,
  canTransition,
  type ItemStatus,
  type StepStatus,
  type ThreadStatus,
  type TurnStatus,
} from "../../src/conversation/index.ts";
import { rawId } from "../helpers/ids.ts";
import {
  assistantStop,
  systemMessage,
  toolResult,
  userText,
  usage,
} from "./fixtures/pi-messages.ts";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const THREAD_STATES: readonly ThreadStatus[] = ["idle", "running", "closed"];
const TURN_STATES: readonly TurnStatus[] = [
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
];
const STEP_STATES: readonly StepStatus[] = [
  "requesting",
  "tools",
  "completed",
  "interrupted",
  "failed",
];
const ITEM_STATES: readonly ItemStatus[] = ["in_progress", "completed", "failed", "interrupted"];

/** 스펙 §3.5.1 표를 그대로 옮긴 기대 전이 쌍 */
const THREAD_EDGES = ["idle>running", "running>idle", "idle>closed"];
const TURN_EDGES = [
  "running>waiting",
  "waiting>running",
  "running>completed",
  "running>interrupted",
  "running>failed",
  "waiting>completed",
  "waiting>interrupted",
  "waiting>failed",
];
const STEP_EDGES = [
  "requesting>tools",
  "requesting>completed",
  "tools>completed",
  "requesting>interrupted",
  "requesting>failed",
  "tools>interrupted",
  "tools>failed",
];
const ITEM_EDGES = ["in_progress>completed", "in_progress>failed", "in_progress>interrupted"];

function checkTable<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  states: readonly S[],
  edges: readonly string[],
): void {
  for (const from of states) {
    for (const to of states) {
      expect(canTransition(table, from, to)).toBe(edges.includes(`${from}>${to}`));
    }
  }
}

describe("state transitions", () => {
  test("thread table matches the spec", () =>
    checkTable(THREAD_TRANSITIONS, THREAD_STATES, THREAD_EDGES));
  test("turn table matches the spec", () => checkTable(TURN_TRANSITIONS, TURN_STATES, TURN_EDGES));
  test("step table matches the spec", () => checkTable(STEP_TRANSITIONS, STEP_STATES, STEP_EDGES));
  test("item table matches the spec", () => checkTable(ITEM_TRANSITIONS, ITEM_STATES, ITEM_EDGES));

  test("terminal states have no outgoing edges", () => {
    expect(THREAD_TRANSITIONS.closed).toEqual([]);
    for (const terminal of ["completed", "interrupted", "failed"] as const) {
      expect(TURN_TRANSITIONS[terminal]).toEqual([]);
      expect(STEP_TRANSITIONS[terminal]).toEqual([]);
      expect(ITEM_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

const THREAD = rawId("thr", 1);
const EVENT = rawId("evt", 1);
const ITEM = rawId("itm", 1);
const PART = rawId("prt", 1);
const EFFECT = rawId("efx", 1);

describe("payload schemas round trip", () => {
  const partRecord = {
    partId: PART,
    itemId: ITEM,
    contentIndex: 0,
    kind: "text",
    toolCallId: null,
  };
  const cases: readonly (readonly [string, Parameters<typeof parse>[0], unknown])[] = [
    [
      "ThreadStarted",
      ThreadStartedPayloadSchema,
      { title: "t", forkedFrom: { threadId: THREAD, eventId: EVENT } },
    ],
    ["ThreadStarted null", ThreadStartedPayloadSchema, { title: null, forkedFrom: null }],
    [
      "ThreadStarted with workspace",
      ThreadStartedPayloadSchema,
      { title: null, forkedFrom: null, workspace: "/work/app" },
    ],
    [
      "ThreadStarted with null workspace",
      ThreadStartedPayloadSchema,
      { title: null, forkedFrom: null, workspace: null },
    ],
    [
      "ThreadUpdated",
      ThreadUpdatedPayloadSchema,
      { title: null, status: "running", leafEventId: EVENT },
    ],
    ["ThreadUpdated empty", ThreadUpdatedPayloadSchema, {}],
    ["ThreadClosed", ThreadClosedPayloadSchema, { reason: null }],
    [
      "TurnStarted",
      TurnStartedPayloadSchema,
      { inputItemIds: [ITEM], requestId: "r1", scopeId: null },
    ],
    ["TurnUpdated", TurnUpdatedPayloadSchema, { status: "waiting" }],
    [
      "TurnCompleted",
      TurnCompletedPayloadSchema,
      { status: "completed", stepCount: 2, usage, error: null },
    ],
    ["StepStarted", StepStartedPayloadSchema, { stepIndex: 0 }],
    ["StepUpdated", StepUpdatedPayloadSchema, { status: "tools" }],
    [
      "StepCompleted",
      StepCompletedPayloadSchema,
      {
        stepIndex: 1,
        status: "completed",
        stopReason: "toolUse",
        assistantItemId: ITEM,
        toolResultItemIds: [],
      },
    ],
    [
      "ItemStarted",
      ItemStartedPayloadSchema,
      { itemId: ITEM, kind: "toolCall", toolCallId: "call_1", toolName: "read" },
    ],
    [
      "ItemUpdated part_delta",
      ItemUpdatedPayloadSchema,
      {
        itemId: ITEM,
        update: {
          kind: "part_delta",
          delta: {
            partId: PART,
            itemId: ITEM,
            contentIndex: 0,
            kind: "text",
            phase: "delta",
            delta: "hi",
          },
        },
      },
    ],
    [
      "ItemUpdated part_completed",
      ItemUpdatedPayloadSchema,
      { itemId: ITEM, update: { kind: "part_completed", part: partRecord } },
    ],
    [
      "ItemUpdated tool_progress",
      ItemUpdatedPayloadSchema,
      {
        itemId: ITEM,
        update: {
          kind: "tool_progress",
          partialResult: { content: [{ type: "text", text: "..." }] },
        },
      },
    ],
  ];
  for (const [name, schema, value] of cases) {
    test(name, () => {
      expect(parse(schema, roundTrip(value)).ok).toBe(true);
    });
  }

  test("closed payloads reject unknown fields and bad enums", () => {
    expect(parse(TurnUpdatedPayloadSchema, { status: "paused" }).ok).toBe(false);
    expect(parse(StepStartedPayloadSchema, { stepIndex: 0, extra: 1 }).ok).toBe(false);
    expect(parse(StepStartedPayloadSchema, { stepIndex: -1 }).ok).toBe(false);
    expect(
      parse(TurnCompletedPayloadSchema, {
        status: "running",
        stepCount: 0,
        usage: null,
        error: null,
      }).ok,
    ).toBe(false);
    expect(parse(ItemUpdatedPayloadSchema, { itemId: ITEM, update: { kind: "other" } }).ok).toBe(
      false,
    );
  });

  test("ThreadStarted.workspace is optional so rows written before it still parse", () => {
    // M1이 쓴 옛 행에는 workspace가 없다. 없는 값은 null과 같다
    expect(parse(ThreadStartedPayloadSchema, { title: "t", forkedFrom: null }).ok).toBe(true);
    const base = { title: null, forkedFrom: null };
    expect(parse(ThreadStartedPayloadSchema, { ...base, workspace: "" }).ok).toBe(false);
    expect(parse(ThreadStartedPayloadSchema, { ...base, workspace: "x".repeat(4097) }).ok).toBe(
      false,
    );
    expect(parse(ThreadStartedPayloadSchema, { ...base, workspace: 5 }).ok).toBe(false);
  });
});

describe("item records", () => {
  const base = { itemId: ITEM, status: "completed" } as const;

  test("each kind round-trips", () => {
    const records: readonly unknown[] = [
      { ...base, kind: "user", message: userText, requestId: null },
      { ...base, kind: "user", message: userText, requestId: "req-1" },
      { ...base, kind: "assistant", message: assistantStop, partIds: [PART, PART] },
      { ...base, kind: "system", message: systemMessage },
      { ...base, kind: "toolResult", message: toolResult, effectId: EFFECT },
      { ...base, kind: "toolResult", message: toolResult, effectId: null },
      {
        ...base,
        kind: "custom",
        message: {
          role: "custom",
          customType: "grp.helm.item.tagged",
          content: "x",
          display: false,
          details: { a: 1 },
          timestamp: 1,
        },
      },
    ];
    for (const record of records) expect(parse(ItemRecordSchema, roundTrip(record)).ok).toBe(true);
  });

  test("a kind/message mismatch is rejected", () => {
    expect(
      parse(ItemRecordSchema, { ...base, kind: "user", message: assistantStop, requestId: null })
        .ok,
    ).toBe(false);
    expect(parse(ItemRecordSchema, { ...base, kind: "assistant", message: assistantStop }).ok).toBe(
      false,
    );
  });

  test("ToolCallItem", () => {
    const item = {
      itemId: ITEM,
      kind: "toolCall",
      toolCallId: "c",
      toolName: "read",
      effectId: null,
      status: "in_progress",
    };
    expect(parse(ToolCallItemSchema, item).ok).toBe(true);
    expect(parse(ToolCallItemSchema, { ...item, status: "done" }).ok).toBe(false);
  });
});
