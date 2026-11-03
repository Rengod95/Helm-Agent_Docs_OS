import { expect, test } from "bun:test";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope, EventKind } from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { summarizeUsage } from "../src/index.ts";

// T-MEAS-FIX: 그룹 사용량(토큰과 비용)의 원천은 이벤트 접기 하나다. drive 턴은 `turn.completed`, 자식은 `agent.settled`에서 오고,
// 부분(scope별 drive 턴 + 자식)의 합이 전체와 맞는다.

const ids = fixedIdFactory(500);
const THREAD = ids.next("thr");
const CHILD_A = ids.next("thr");
const CHILD_B = ids.next("thr");
const CHILD_C = ids.next("thr");
const TURN: TurnId = ids.next("trn");

function envelope(
  seq: number,
  kind: EventKind,
  payload: unknown,
  turnId: TurnId | null = null,
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId,
    stepId: null,
    recordedAt: seq * 10,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

function usage(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  total: number,
) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
  };
}

function spawned(seq: number, child: ThreadId, owner: unknown): DurableEventEnvelope {
  return envelope(seq, "agent.spawned", {
    childThreadId: child,
    agent: "lens",
    requestId: `req-${child}`,
    owner,
    caller: "subagent:lens",
    depth: 1,
    background: true,
    fork: null,
    modelRole: "main",
  });
}

function settled(
  seq: number,
  child: ThreadId,
  used: ReturnType<typeof usage> | null,
  owner?: unknown,
): DurableEventEnvelope {
  return envelope(seq, "agent.settled", {
    childThreadId: child,
    requestId: `req-${child}`,
    status: "completed",
    report: null,
    answerItemId: null,
    usage: used,
    error: null,
    ...(owner === undefined ? {} : { owner }),
  });
}

const DRIVE_OWNER = { kind: "drive", turnId: null, scopeId: "helm", leaseId: "lease-1" };

const EVENTS: readonly DurableEventEnvelope[] = [
  envelope(1, "turn.started", { inputItemIds: [], requestId: null, scopeId: "helm" }, TURN),
  envelope(
    2,
    "turn.completed",
    { status: "completed", stepCount: 1, usage: usage(100, 10, 5, 1, 1), error: null },
    TURN,
  ),
  // Helm 렌즈 자식: owner가 drive
  spawned(3, CHILD_A, DRIVE_OWNER),
  settled(4, CHILD_A, usage(20, 2, 0, 0, 0.25), DRIVE_OWNER),
  // owner가 없는 옛 기록은 agent.spawned의 owner를 읽는다
  spawned(5, CHILD_B, { kind: "scope", scopeId: "learning" }),
  settled(6, CHILD_B, usage(7, 3, 1, 1, 0.5)),
  // 도구가 낳은 자식은 그룹에 귀속하지 않는다
  spawned(7, CHILD_C, { kind: "tool", turnId: TURN, toolCallId: "call-1" }),
  settled(8, CHILD_C, usage(1000, 1000, 0, 0, 9), {
    kind: "tool",
    turnId: TURN,
    toolCallId: "call-1",
  }),
  // 같은 자식의 정착이 두 번 읽혀도 한 번만 센다
  settled(9, CHILD_A, usage(20, 2, 0, 0, 0.25), DRIVE_OWNER),
];

test("metrics.usage-sources-attribute-drive-turns-and-child-usage-once", () => {
  const summary = summarizeUsage(EVENTS);
  expect(summary.get("helm")?.tokens).toEqual({
    input: 120,
    output: 12,
    cacheRead: 5,
    cacheWrite: 1,
  });
  expect(summary.get("helm")?.costUsd).toBeCloseTo(1.25, 10);
  expect(summary.get("learning")?.tokens).toEqual({
    input: 7,
    output: 3,
    cacheRead: 1,
    cacheWrite: 1,
  });
  expect(summary.get("learning")?.costUsd).toBeCloseTo(0.5, 10);
  expect([...summary.keys()].toSorted()).toEqual(["helm", "learning"]);
});

test("metrics.usage-sources-parts-sum-to-the-whole", () => {
  const summary = summarizeUsage(EVENTS);
  const parts = [...summary.values()];
  const whole = {
    input: 100 + 20 + 7,
    output: 10 + 2 + 3,
    cacheRead: 5 + 0 + 1,
    cacheWrite: 1 + 0 + 1,
    costUsd: 1 + 0.25 + 0.5,
  };
  expect({
    input: parts.reduce((sum, part) => sum + part.tokens.input, 0),
    output: parts.reduce((sum, part) => sum + part.tokens.output, 0),
    cacheRead: parts.reduce((sum, part) => sum + part.tokens.cacheRead, 0),
    cacheWrite: parts.reduce((sum, part) => sum + part.tokens.cacheWrite, 0),
  }).toEqual({
    input: whole.input,
    output: whole.output,
    cacheRead: whole.cacheRead,
    cacheWrite: whole.cacheWrite,
  });
  expect(parts.reduce((sum, part) => sum + part.costUsd, 0)).toBeCloseTo(whole.costUsd, 10);
});
