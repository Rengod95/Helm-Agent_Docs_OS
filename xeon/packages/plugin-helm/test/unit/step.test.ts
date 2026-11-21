import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { DriveLockBudget, PostItem, StepResult } from "@fresnel/contracts/extensions";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { OrchestrationApi } from "@fresnel/orchestration-sdk";
import { helmDrive, spawnRequestId, turnRequestId } from "../../src/drive.ts";
import type { ExplorationMarker } from "../../src/guard.ts";
import { DEFAULT_HELM_SETTINGS } from "../../src/settings.ts";
import { INITIAL_HELM_STATE, type HelmState } from "../../src/state.ts";

// 단계 함수를 엔진 없이 부른다. 같은 상태와 같은 직전 결과에서 같은 명령이 나오는지, 효과가 어떤 순서로 나가는지를 본다

const ids = fixedIdFactory(0);
const TURN = ids.next("trn");
const THREAD = ids.next("thr");
const ID = "habcdefghijklm";
const TOPIC = "캐시 무효화";
const FULL: DriveLockBudget = { turns: 4, spawns: 8, tokens: 400000 };
const FRAME = { frameDepth: 1, calledBy: null, input: null };
const MESSAGE: PostItem = { kind: "user", content: "중간에 한 말" };
const REPORT =
  '```json\n{"findings":[{"claim":"x","sources":[],"confidence":"high","followUp":"do x"}]}\n```';
const LENSES = [
  { id: "analogy", title: "다른 분야의 유사 문제", status: "pending" as const },
  { id: "prior-art", title: "선행 사례와 문헌", status: "pending" as const },
];

interface Effects {
  readonly records: { readonly kind: string; readonly payload: JsonValue }[];
  readonly posts: string[];
}

function stubApi(
  effects: Effects,
): Pick<OrchestrationApi<HelmState>, "record" | "post" | "capability"> {
  return {
    record: (kind, _subject, payload) => {
      effects.records.push({ kind, payload });
      return Promise.resolve();
    },
    post: (_item, options) => {
      const requestId = options.requestId;
      effects.posts.push(requestId);
      return Promise.resolve({ requestId, duplicate: false });
    },
    // 단계 함수의 이 시험들은 기능을 부르지 않는다. 부르면 시험이 잘못된 것이다
    capability: () => {
      throw new Bug("the step test calls no capability");
    },
  };
}

function stateOf(overrides: Partial<HelmState>): HelmState {
  return { ...INITIAL_HELM_STATE, ...overrides };
}

function inquiryAt(overrides: Partial<HelmState>): HelmState {
  return stateOf({
    inquiryId: ID,
    topic: TOPIC,
    round: 1,
    lenses: LENSES,
    ...overrides,
  });
}

/** 단계 함수 한 번 호출. 효과 기록은 `effects`에 쌓인다 */
function stepper(effects: Effects) {
  const marker: ExplorationMarker = { phase: "idle" };
  const step = helmDrive(stubApi(effects), () => DEFAULT_HELM_SETTINGS, marker);
  return (state: HelmState, last: StepResult | null, budget: DriveLockBudget = FULL) =>
    step({ state, last, budget, frame: FRAME });
}

function freshEffects(): Effects {
  return { records: [], posts: [] };
}

test("step.idle-without-pending-is-done", async () => {
  const effects = freshEffects();
  const run = stepper(effects);
  expect(await run(INITIAL_HELM_STATE, null)).toEqual({ do: "done" });
  expect(effects).toEqual({ records: [], posts: [] });
});

test("step.user-message-becomes-a-turn-and_the-phase-goes-on", async () => {
  const run = stepper(freshEffects());
  const diverge = inquiryAt({ phase: "diverge" });
  // 사용자 메시지는 그 자체가 턴 명령이다. 턴 명령은 맨 위에 와야 엔진이 메시지를 처리한 것으로 본다
  expect(await run(diverge, { kind: "user", message: MESSAGE, requestId: "msg-1" })).toEqual({
    do: "turn",
    input: MESSAGE,
  });
  // 그 턴이 끝나면 같은 단계가 발산 턴을 낸다. 사용자 턴의 결과는 발산 턴의 결과가 아니다
  const after = await run(diverge, {
    kind: "ok",
    of: "turn",
    value: { turnId: TURN, status: "completed" },
  });
  // 입력은 발산 프롬프트다(사용자 메시지가 아니다). 턴 표지를 먼저 커밋한다
  expect(after).toMatchObject({
    do: "commit",
    state: { phase: "diverge", awaitingTurn: true },
    next: { do: "turn", requestId: turnRequestId(ID, "diverge", 1) },
  });
});

test("step.same-state-and-last-give-the-same-command", async () => {
  // 재시작 뒤 같은 단계가 다시 와도 같은 명령을 낸다. 턴과 spawn의 요청 id는 상태에서 정한다
  const effects = freshEffects();
  const run = stepper(effects);
  const waiting = inquiryAt({ phase: "diverge", awaitingTurn: true });
  const first = await run(waiting, null);
  const second = await run(waiting, null);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ do: "turn", requestId: turnRequestId(ID, "diverge", 1) });

  const running = inquiryAt({
    phase: "explore",
    lenses: [
      { id: "analogy", title: "다른 분야의 유사 문제", status: "running" },
      { id: "prior-art", title: "선행 사례와 문헌", status: "running" },
    ],
  });
  const spawnFirst = await run(running, null);
  expect(spawnFirst).toEqual(await run(running, null));
  expect(spawnFirst).toMatchObject({
    do: "spawn",
    agent: "explorer",
    requestId: spawnRequestId(ID, 1, "analogy"),
  });
  // 단계 함수는 효과를 내지 않는다. 기록과 알림만 낸다
  expect(effects.records).toEqual([]);
  expect(effects.posts).toEqual([]);
});

test("step.lens-result-is-committed-before-the-next-lens-starts", async () => {
  const run = stepper(freshEffects());
  const running = inquiryAt({
    phase: "explore",
    lenses: [
      { id: "analogy", title: "다른 분야의 유사 문제", status: "running" },
      { id: "prior-art", title: "선행 사례와 문헌", status: "running" },
    ],
  });
  const next = await run(running, {
    kind: "ok",
    of: "spawn",
    value: { childThreadId: THREAD, status: "completed", answer: REPORT },
  });
  // 첫 렌즈의 결과가 상태에 들어간 뒤 두 번째 렌즈를 낸다
  expect(next).toMatchObject({
    do: "commit",
    state: {
      phase: "explore",
      lenses: [
        { id: "analogy", status: "done" },
        { id: "prior-art", status: "running" },
      ],
    },
    next: { do: "spawn", requestId: spawnRequestId(ID, 1, "prior-art") },
  });
});

test("step.turn-budget-gone-finishes-the-inquiry-after-the-records", async () => {
  const effects = freshEffects();
  const run = stepper(effects);
  const diverge = inquiryAt({ phase: "diverge" });
  const command = await run(diverge, null, { turns: 0, spawns: 8, tokens: 400000 });
  // 한도가 바닥이면 턴을 내지 않고, 종료 기록과 알림을 먼저 내고 상태를 idle로 커밋한다. 그다음 주도권을 내려놓는다
  expect(command).toMatchObject({ do: "commit", state: { phase: "idle" }, next: { do: "done" } });
  expect(effects.records.map((record) => record.kind)).toEqual(["grp.helm.inquiry.finished"]);
  expect(effects.records[0]?.payload).toMatchObject({ outcome: "limit", limit: "turns" });
  expect(effects.posts).toHaveLength(1);
  expect(effects.posts[0]?.endsWith(":limit")).toBe(true);
});

test("step.refused-state-conflict-yields-without-effects", async () => {
  // 상태 판이 바뀌어 거부된 커밋은 커밋 없이 기다린다. 기록도 알림도 내지 않는다
  const effects = freshEffects();
  const run = stepper(effects);
  const command = await run(inquiryAt({ phase: "explore" }), {
    kind: "refused",
    code: "state_conflict",
  });
  expect(command).toEqual({ do: "yield" });
  expect(effects).toEqual({ records: [], posts: [] });
});
