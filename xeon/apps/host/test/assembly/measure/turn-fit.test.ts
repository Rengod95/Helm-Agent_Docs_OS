import { expect, test } from "bun:test";
import type { HookRun, StepRecord, TurnRecord } from "@fresnel/contracts/wire";
import { fitTurnRecord, REF_SHRINK_CHARS } from "../../../src/assembly/measure/turn-fit.ts";

// 턴 기록 크기 상한의 줄이기 순서(정본 §4.1 규칙 8). 줄이기 단계마다 경계 값에서 정확히 맞는지 본다.

function bytesOf(record: TurnRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function hookOf(
  seq: number,
  atMs: number,
  result: HookRun["result"],
  text: string | null,
): HookRun {
  return {
    hook: "tool.call.before",
    registrationId: `reg-${String(seq)}`,
    plugin: "guard",
    versionId: null,
    sourceKind: "plugin",
    seq,
    subject: { toolCallId: "tc_1" },
    toolCallId: "tc_1",
    result,
    reason: null,
    decision: result === "blocked" ? "block" : "none",
    ask: null,
    ms: 1,
    atMs,
    size: 0,
    skippedBy: null,
    decisionText: text,
  };
}

// 줄인 칸의 셈(`elided`)이 붙는 바이트보다 ref를 자른 줄어듦이 커야 첫 단계가 실제로 줄인다
const LONG_REF = "m".repeat(200);
const SHORT_REF = "m".repeat(REF_SHRINK_CHARS);

interface StepOptions {
  readonly ref?: string;
  readonly tools?: boolean;
}

function stepOf(hooks: readonly HookRun[], options: StepOptions = {}): StepRecord {
  const tools =
    options.tools === false
      ? []
      : [{ name: "shell", plugin: "shell", tokens: 80, state: "advertised" as const, called: 0 }];
  return {
    stepIndex: 0,
    stepId: "stp_1",
    modelCalls: [],
    materials: [
      {
        plugin: "notes",
        versionId: null,
        registrationId: null,
        kind: "always",
        material: "instruction",
        ref: options.ref ?? LONG_REF,
        tokens: 10,
        truncated: false,
        omitted: null,
        itemId: null,
        attribution: "declared",
      },
    ],
    advertised: {
      count: 1,
      tokens: 80,
      deferredCount: 0,
      removedCount: 0,
      fingerprint: "fp-1",
      byPlugin: [],
      tools,
    },
    cache: null,
    hooks: [...hooks],
    calls: [],
    composition: null,
    recorded: true,
  };
}

function recordOf(step: StepRecord, elided: TurnRecord["elided"] = {}): TurnRecord {
  return {
    schema: 1,
    threadId: "thr_1",
    turnId: "trn_1",
    parent: null,
    origin: "user",
    startedAt: 1000,
    endedAt: 2000,
    status: "completed",
    level: "full",
    complete: true,
    scope: "live",
    profile: null,
    profileRevChanges: [],
    overlay: null,
    testRun: null,
    children: [],
    frames: [],
    steps: [step],
    turnHooks: [],
    continues: [],
    skills: { listed: [], listedOmitted: 0, read: [] },
    cost: [],
    pluginCalls: [],
    pluginStderr: [],
    flags: {
      blockedIntent: 0,
      blockedFault: 0,
      deniedPolicy: 0,
      deniedHuman: 0,
      deniedNoninteractive: 0,
      replaced: 0,
      cancelledAsk: 0,
      asked: 0,
      modified: 0,
      timedOut: 0,
      failed: 0,
      drive: false,
      cacheBreak: false,
      subagents: 0,
      truncatedMaterials: 0,
      draftActive: false,
      untrackedWrite: false,
    },
    elided,
  };
}

const TEXT = "a decision text";
/** 결과가 passed인 것 둘(atMs 1, 2)과 blocked 하나. 모두 결정 문구가 있다 */
const PASSED_OLD = hookOf(1, 1, "passed", TEXT);
const PASSED_NEW = hookOf(2, 2, "passed", TEXT);
const BLOCKED = hookOf(3, 3, "blocked", TEXT);

const BASE = recordOf(stepOf([PASSED_OLD, PASSED_NEW, BLOCKED]));

/** 1단계: 재료 ref를 자른 기록 */
const STAGE1 = recordOf(stepOf([PASSED_OLD, PASSED_NEW, BLOCKED], { ref: SHORT_REF }), {
  materials: 1,
});

/** 2단계: 광고 도구 목록을 비운 기록 */
const STAGE2 = recordOf(
  stepOf([PASSED_OLD, PASSED_NEW, BLOCKED], { ref: SHORT_REF, tools: false }),
  {
    materials: 1,
    tools: 1,
  },
);

/** 3단계: 훅의 결정 문구를 비운 기록(셋 모두) */
function cleared(hook: HookRun): HookRun {
  return { ...hook, decisionText: null };
}
const CLEARED_NEW = cleared(PASSED_NEW);
const CLEARED_BLOCKED = cleared(BLOCKED);
const STAGE3 = recordOf(
  stepOf([cleared(PASSED_OLD), CLEARED_NEW, CLEARED_BLOCKED], { ref: SHORT_REF, tools: false }),
  {
    materials: 1,
    tools: 1,
    hooks: 3,
  },
);

test("a record within the cap is returned as it is", () => {
  const fitted = fitTurnRecord(BASE, bytesOf(BASE));
  expect(fitted.record).toBe(BASE);
  expect(fitted.summarized).toBe(false);
  expect(fitted.bytes).toBe(bytesOf(BASE));
});

test("the first shrink is the material ref, and the cap at its exact size stops there", () => {
  const fitted = fitTurnRecord(BASE, bytesOf(STAGE1));
  expect(fitted.record).toEqual(STAGE1);
  expect(fitted.summarized).toBe(false);
  expect(fitted.bytes).toBe(bytesOf(STAGE1));
});

test("the tool list goes second", () => {
  expect(fitTurnRecord(BASE, bytesOf(STAGE1) - 1).record).toEqual(STAGE2);
  expect(fitTurnRecord(BASE, bytesOf(STAGE2)).record).toEqual(STAGE2);
});

test("the decision texts go third", () => {
  expect(fitTurnRecord(BASE, bytesOf(STAGE2) - 1).record).toEqual(STAGE3);
});

test("passed hook rows go fourth, oldest first, and the fewest rows that fit are removed", () => {
  // 오래된 passed 하나(atMs 1)만 빼면 맞는다. 기대 기록의 셈 칸은 4(결정 문구 3 + 뺀 행 1)다
  const oneOut = recordOf(
    stepOf([CLEARED_NEW, CLEARED_BLOCKED], { ref: SHORT_REF, tools: false }),
    {
      materials: 1,
      tools: 1,
      hooks: 4,
    },
  );
  const fitted = fitTurnRecord(BASE, bytesOf(oneOut));
  expect(fitted.record.steps[0]?.hooks.map((hook) => hook.atMs)).toEqual([2, 3]);
  expect(fitted.record.elided).toEqual({ materials: 1, tools: 1, hooks: 4 });
  expect(fitted.summarized).toBe(false);
  // 맞는 것 중 가장 적게 뺀다: 한 개도 빼지 않은 STAGE3는 이 상한에 들지 않는다
  expect(bytesOf(STAGE3)).toBeGreaterThan(bytesOf(oneOut));
});

test("when nothing else fits, the turn is summarized with complete false and the steps are dropped", () => {
  const fitted = fitTurnRecord(BASE, 1);
  expect(fitted.summarized).toBe(true);
  expect(fitted.record.complete).toBe(false);
  expect(fitted.record.steps).toEqual([]);
  expect(fitted.record.turnHooks).toEqual([]);
  // 센 칸: 재료 2(ref 줄임 1, 요약 1), 도구 1, 훅 6(결정 문구 3, passed 둘, 요약에서 남은 blocked 하나)
  expect(fitted.record.elided).toEqual({ materials: 2, tools: 1, hooks: 6 });
  expect(fitted.json).toBe(JSON.stringify(fitted.record));
  expect(fitted.bytes).toBe(bytesOf(fitted.record));
});
