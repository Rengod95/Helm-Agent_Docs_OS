// 주도 단계 함수를 실제 호스트와 drive 락 중재자 위에서 돌린다. 명령이 이어지는 순서, 기본 요청 id와 재시작 재실행,
// 명시 id, done·yield·idle 반납, 아직 없는 명령의 거부 결과, drive.command_settled 사건, 사용자 메시지 전달, 효과 없는 명령의 상한,
// state_conflict 거부를 본다. 승인 서비스, 기록 저장소, 루프는 대역이다.
import { expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  PluginModelError,
  PluginModelResult,
  ToolError,
  ToolResultView,
} from "@fresnel/contracts/capabilities";
import type {
  AskCard,
  DriveCommand,
  DriveLimits,
  DriveLockBudget,
  DriveStep,
  DriveStepInput,
  PostItem,
  RegistrationApi,
  RegistrationDef,
  StepResult,
} from "@fresnel/contracts/extensions";
import {
  DriveCommandSettledPayloadSchema,
  type DriveCommandSettledPayload,
} from "@fresnel/contracts/records";
import { Type } from "typebox";
import { MAX_CHAINED_REINVOKES, MAX_DRIVE_TOOL_COMMANDS } from "../../src/primitives/lease.ts";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import {
  acquiredOf,
  fakeApprovals,
  provideApprovals,
  releasedOf,
  type FakeApprovals,
  type Host,
} from "./fixtures/fake-approvals.ts";
import {
  fakeModels,
  fakeTools,
  provideModelsPort,
  provideToolsPort,
} from "./fixtures/fake-plugin-calls.ts";
import { makeGroupUnit, snapshotOf } from "./fixtures/support.ts";

interface Counter {
  readonly count: number;
}

const CounterSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });
const COUNTER_DEF: RegistrationDef<Counter> = {
  state: { schema: CounterSchema, initial: { count: 0 }, version: 1 },
};

/** 루프의 턴과 서브에이전트 결과를 고정한다. 단계 함수가 받은 `last`를 시험이 정확한 값으로 비교하게 한다 */
const ids = fixedIdFactory(9000);
const TURN = ids.next("trn");
const CHILD = ids.next("thr");
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
  runSpawn: () =>
    Promise.resolve({ outcome: { childThreadId: CHILD, status: "completed" }, usage: null }),
};

const GO: PostItem = { kind: "user", content: "go" };
const CARD: AskCard = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};
const ANSWER = { q1: { selected: ["yes"] } };

const TURN_RESULT: StepResult = {
  kind: "ok",
  of: "turn",
  value: { turnId: TURN, status: "completed" },
};
/** 없는 대상에 `handoff`를 내면 받는 거부 결과(`model`, `tool`은 실행되므로 거부 예시는 `handoff`다) */
const REFUSED: StepResult = { kind: "refused", code: "target_unavailable" };
/** E2 뒤에도 아직 없는 명령(E3). 거부되는 효과 없는 명령의 본보기로 쓴다 */
const HANDOFF: DriveCommand<Counter> = { do: "handoff", to: "other", input: "x" };
const MODEL: DriveCommand<Counter> = {
  do: "model",
  messages: [{ role: "user", content: "hi" }],
};
const ASK: DriveCommand<Counter> = { do: "ask", card: CARD, requestId: "ask-1" };

/** 단계 함수가 한 번 불릴 때 본 상태와 `last` */
interface Call {
  readonly state: Readonly<Counter>;
  readonly last: StepResult | null;
}

/** 호출마다 본 것을 기록하고 `decide`가 고른 명령을 돌려주는 단계 함수 */
function stepOf(
  calls: Call[],
  decide: (input: DriveStepInput<Counter>) => DriveCommand<Counter>,
): DriveStep<Counter> {
  return (input) => {
    calls.push({ state: input.state, last: input.last });
    return Promise.resolve(decide(input));
  };
}

async function install(
  t: Host,
  name: string,
  step: DriveStep<Counter>,
  extra?: (g: RegistrationApi<Counter>) => void,
): Promise<void> {
  await t.host.install(
    makeGroupUnit<Counter>({ name, def: COUNTER_DEF }, (g) => {
      g.drive(step);
      extra?.(g);
    }),
  );
}

/** 이 thread에 처음 부여된 임대의 계통 id. 기본 요청 id의 앞부분이다 */
function lineageOf(t: Host, thread: ThreadId): string {
  const [grant] = acquiredOf(t, thread);
  if (grant === undefined) throw new Error("no lease.acquired");
  return grant.lineageId;
}

/** drive.command_settled 사건을 스키마로 읽는다. 기록이 맞지 않으면 시험을 실패시킨다 */
function settledOf(t: Host, thread: ThreadId): DriveCommandSettledPayload[] {
  return t.records.events(thread).flatMap((event): DriveCommandSettledPayload[] => {
    if (event.kind !== "drive.command_settled") return [];
    const parsed = parse(DriveCommandSettledPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("drive.command_settled does not match its schema");
    return [parsed.value];
  });
}

/** 등록된 명령의 처리기를 L4처럼 부른다(direct-drive.test.ts와 같은 방식) */
function runCommand(t: Host, threadId: ThreadId, invocationId: string): Promise<void> {
  const def = t.host.resources.list("command")[0]?.def;
  if (typeof def !== "object" || def === null || !("handler" in def)) {
    throw new Error("command is not registered");
  }
  const handler = def.handler;
  if (typeof handler !== "function") throw new Error("command handler is not a function");
  return Promise.resolve(
    handler.call(def, "", { threadId, invocationId, signal: new AbortController().signal }),
  );
}

/** 첫 승인 요청에 질문 답을 넣고 백그라운드 작업이 끝나기를 기다린다 */
async function answerFirst(approvals: FakeApprovals, t: Host): Promise<void> {
  const request = approvals.created[0];
  if (request === undefined) throw new Error("no approval was opened");
  expect(
    await approvals.service.respond(request.approvalId, { decision: "answer", answer: ANSWER }),
  ).toEqual({ applied: true });
  await t.settled();
}

test("one invoke runs a turn and then a commit, and each step gets the previous result as last", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "step-chain",
    stepOf(calls, ({ state, last }) => {
      if (last === null) return { do: "turn", input: GO, requestId: "turn-1" };
      if (last.kind === "ok" && last.of === "turn") {
        return { do: "commit", state: { count: state.count + 1 }, next: { do: "yield" } };
      }
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "step-chain");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([null, TURN_RESULT]);
  expect(calls.map((call) => call.state)).toEqual([{ count: 0 }, { count: 0 }]);
  expect(t.loop.turns).toHaveLength(1);
  // 턴과 상태 커밋이 한 임대 안에서 이어졌고, 명령 결과 기록이 실패하지 않았다
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states.map((state) => state.doc)).toEqual([{ count: 1 }]);
});

test("the default request id is lineage:rev.index and a restart re-runs the step with the same key, so the turn runs once", async () => {
  const first = await createTestHost({ loop: SCRIPTED });
  const thread = first.newThread();
  const step = (calls: Call[]): DriveStep<Counter> =>
    stepOf(calls, ({ last }) => (last === null ? { do: "turn", input: GO } : { do: "yield" }));
  const firstCalls: Call[] = [];
  await install(first, "rerun-default-key", step(firstCalls));
  await first.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await first.settled();
  first.host.startDrive(thread, "rerun-default-key");
  await first.settled();

  // 상태 판 0에서 첫 단계의 첫 명령이므로 순번은 0이다
  const lineage = lineageOf(first, thread);
  expect(first.loop.turns.map((turn) => turn.requestId)).toEqual([`${lineage}:0.0`]);
  expect(firstCalls.map((call) => call.last)).toEqual([null, TURN_RESULT]);

  // 프로세스 재시작: 옛 호스트를 닫고 같은 기록으로 새 호스트를 연다
  await first.host.dispose();
  const second = await first.restart();
  const secondCalls: Call[] = [];
  await install(second, "rerun-default-key", step(secondCalls));
  await second.host.openThread(thread);
  await second.settled();

  // 열린 임대를 이어 받아 같은 단계를 다시 돌리고, 같은 키의 턴은 재생되어 새 턴이 없다
  expect(secondCalls.map((call) => call.last)).toEqual([null, TURN_RESULT]);
  expect(first.loop.turns.map((turn) => turn.requestId)).toEqual([`${lineage}:0.0`]);
  expect(acquiredOf(second, thread)).toHaveLength(1);
});

test("an explicit requestId is the one the loop receives for a turn and for a spawn", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "explicit-key",
    stepOf(calls, ({ last }) => {
      if (last === null) return { do: "turn", input: GO, requestId: "turn-explicit" };
      if (last.kind === "ok" && last.of === "turn") {
        return {
          do: "spawn",
          agent: "worker",
          task: "child",
          requestId: "spawn-explicit",
        };
      }
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "explicit-key");
  await t.settled();

  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-explicit"]);
  expect(t.loop.spawns.map((spawn) => spawn.requestId)).toEqual(["spawn-explicit"]);
});

test("done releases the lease with reason done, and the same scope is not granted again until a new start request", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "done-scope",
    stepOf(calls, ({ state }) => (state.count === 0 ? { do: "done" } : { do: "yield" })),
    (g) => {
      hostOf(g).registerCommand("bump", {
        handler: async () => {
          await g.commit({ count: g.state().count + 1 });
        },
      });
    },
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "done-scope");
  await t.settled();
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
  expect(t.host.leaseOf(thread)).toBeNull();

  // 상태 판이 그대로면 턴 경계와 유휴 경계를 지나도 임대를 다시 받지 않는다
  await t.boundary(thread).turnSettled();
  await t.settled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(calls.map((call) => call.state)).toEqual([{ count: 0 }]);

  // 상태를 커밋해도 done으로 내린 scope는 새 시작 요청이 없으면 다시 부여되지 않는다. 스택이 비어 아무도 주도하지 않는다
  await runCommand(t, thread, "bump-1");
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(calls.map((call) => call.state)).toEqual([{ count: 0 }]);
  expect(t.host.leaseOf(thread)).toBeNull();

  // 새 시작 요청이 있으면 다시 부여되고, 단계 함수는 커밋된 상태 1을 본다
  expect(t.host.startDrive(thread, "done-scope").ok).toBe(true);
  await t.settled();
  expect(acquiredOf(t, thread)).toHaveLength(2);
  expect(calls.map((call) => call.state)).toEqual([{ count: 0 }, { count: 1 }]);
  expect(calls.map((call) => call.last)).toEqual([null, null]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

test("two yields in a row at the same state rev give the lease back as idle", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "yield-idle",
    stepOf(calls, () => ({ do: "yield" })),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "yield-idle");
  await t.settled();
  expect(calls).toHaveLength(1);
  expect(t.host.leaseOf(thread)).not.toBeNull();

  // 같은 판에서 두 번째 yield로 유휴 반납이 된다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(calls.map((call) => call.last)).toEqual([null, null]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["idle"]);
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(t.loop.turns).toHaveLength(0);
});

test("each command settles once with its lease, scope, request id, command, outcome and ref", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const calls: Call[] = [];
  await install(
    t,
    "settle-events",
    stepOf(calls, ({ state, last }) => {
      if (last === null && state.count === 0) {
        return { do: "turn", input: GO, requestId: "turn-1" };
      }
      if (last?.kind === "ok" && last.of === "turn") {
        return {
          do: "commit",
          state: { count: state.count + 1 },
          next: { do: "spawn", agent: "worker", task: "child", requestId: "spawn-1" },
        };
      }
      if (last?.kind === "ok" && last.of === "spawn") return ASK;
      if (last?.kind === "ask" && last.answer === "answered") return { do: "done" };
      return ASK;
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "settle-events");
  await t.settled();
  // 시작 요청으로 받은 임대 하나가 턴·맡기기·질문까지 이어진다. 질문은 임대를 반납하지 않고 프레임을 asking으로 둔다
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.driveFrames(thread).map((frame) => frame.state)).toEqual(["driving", "asking"]);

  await answerFirst(approvals, t);
  // 답이 같은 호출 안에서 돌아와 done으로 끝나므로 임대는 done 사유로 한 번 내려간다
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
  expect(settledOf(t, thread)).toEqual([
    {
      scopeId: "settle-events",
      requestId: "turn-1",
      command: "turn",
      outcome: "completed",
      ref: TURN,
    },
    {
      scopeId: "settle-events",
      requestId: "spawn-1",
      command: "spawn",
      outcome: "completed",
      ref: CHILD,
    },
    {
      scopeId: "settle-events",
      requestId: "ask-1",
      command: "ask",
      outcome: "answered",
    },
  ]);
});

test("a restart that replays a turn records no second drive.command_settled for it", async () => {
  const first = await createTestHost({ loop: SCRIPTED });
  const thread = first.newThread();
  await install(
    first,
    "settle-replay",
    stepOf([], ({ last }) => (last === null ? { do: "turn", input: GO } : { do: "yield" })),
  );
  await first.host.openThread(thread);
  first.host.startDrive(thread, "settle-replay");
  await first.settled();
  const before = settledOf(first, thread);
  expect(before).toHaveLength(1);

  // 프로세스 재시작: 옛 호스트를 닫고 새 호스트를 연다. 열린 임대가 있으므로 시작 요청 없이 이어 간다
  await first.host.dispose();
  const second = await first.restart();
  await install(
    second,
    "settle-replay",
    stepOf([], ({ last }) => (last === null ? { do: "turn", input: GO } : { do: "yield" })),
  );
  await second.host.openThread(thread);
  await second.settled();

  expect(first.loop.turns).toHaveLength(1);
  expect(settledOf(second, thread)).toEqual(before);
});

test("a user message claimed while the drive is held becomes the next last, and a turn keeps the drive", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "user-turn",
    stepOf(calls, ({ last }) => {
      if (last === null) return { do: "yield" };
      if (last.kind === "user") return { do: "turn", input: last.message };
      if (last.kind === "ok" && last.of === "turn") return { do: "yield" };
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "user-turn");
  await t.settled();

  const message: PostItem = { kind: "user", content: "stop the lens" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    { kind: "user", message, requestId: "msg-1" },
    TURN_RESULT,
  ]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.leaseOf(thread)).not.toBeNull();
});

test("a user message that arrives while a user-command start request is queued waits for the first step and then becomes the next last", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "user-held",
    stepOf(calls, ({ last }) => {
      if (last === null) return { do: "turn", input: GO };
      if (last.kind === "user") return { do: "turn", input: last.message };
      if (last.kind === "ok" && last.of === "turn") return { do: "yield" };
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "user-held");
  // 부여 전: 시작 요청만 큐에 있다. 메시지는 코어 루프가 아니라 프레임의 몫이다
  const message: PostItem = { kind: "user", content: "first words" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  // 사용자가 명령으로 시작한 주도는 명령이 곧 사용자 요청이라 첫 단계(last null)가 먼저 돌고, 메시지는 그 뒤 단계의 last다 [제안, AGE-47]
  expect(calls[0]?.last).toBeNull();
  expect(calls.filter((call) => call.last?.kind === "user").map((call) => call.last)).toEqual([
    { kind: "user", message, requestId: "msg-1" },
  ]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([GO, message]);
  expect(t.queue.items).toEqual([]);
});

test("a profile's start drive takes the user's first message as the input of its first step, when the message arrives before the lease", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "profile-first",
    stepOf(calls, ({ last }) => {
      if (last === null) return { do: "turn", input: GO };
      if (last.kind === "user") return { do: "turn", input: last.message };
      if (last.kind === "ok" && last.of === "turn") return { do: "yield" };
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "profile-first" });
  // 시작 요청이 큐에 있고 프레임은 아직 없다. 메시지는 프레임이 받을 때까지 쥔다
  const message: PostItem = { kind: "user", content: "first words" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  // 플러그인의 첫 단계는 메시지 없이 먼저 돌지 않는다: 첫 호출의 last가 그 메시지다
  expect(calls[0]?.last).toEqual({ kind: "user", message, requestId: "msg-1" });
  expect(calls.filter((call) => call.last === null)).toEqual([]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(t.queue.items).toEqual([]);
});

test("a profile's start drive waits for the user's first message, and that message arriving after the lease is the input of its first step", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "profile-wait",
    stepOf(calls, ({ last }) => {
      if (last === null) return { do: "turn", input: GO };
      if (last.kind === "user") return { do: "turn", input: last.message };
      if (last.kind === "ok" && last.of === "turn") return { do: "yield" };
      return { do: "done" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "profile-wait" });
  await t.settled();

  // 프레임은 잡혔지만 메시지가 올 때까지 단계 함수를 부르지 않고 turn도 없다
  expect(t.host.leaseOf(thread)).not.toBeNull();
  expect(calls).toEqual([]);
  expect(t.loop.turns).toEqual([]);

  const message: PostItem = { kind: "user", content: "late first words" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  expect(calls[0]?.last).toEqual({ kind: "user", message, requestId: "msg-1" });
  expect(calls.filter((call) => call.last === null)).toEqual([]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(t.queue.items).toEqual([]);
});

async function firstLastOf(settleFirst: boolean): Promise<readonly (StepResult | null)[]> {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "profile-order",
    stepOf(calls, ({ last }) => {
      if (last?.kind === "user") return { do: "turn", input: last.message };
      return { do: "yield" };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "profile-order" });
  if (settleFirst) await t.settled();
  const message: PostItem = { kind: "user", content: "same words" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();
  return calls.slice(0, 1).map((call) => call.last);
}

test("the order does not depend on timing: a message before the lease and a message after it both reach the first step as last", async () => {
  const before = await firstLastOf(false);
  const after = await firstLastOf(true);
  const expected: StepResult = {
    kind: "user",
    message: { kind: "user", content: "same words" },
    requestId: "msg-1",
  };
  expect(before).toEqual([expected]);
  expect(after).toEqual([expected]);
});

test("a profile's start drive that steps back with done on the first message hands that message to the input queue once", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "profile-done",
    stepOf(calls, () => ({ do: "done" })),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "profile-done" });
  await t.settled();
  const message: PostItem = { kind: "user", content: "nobody leads" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  // 첫 단계가 메시지를 받고 `done`으로 물러났다. 메시지는 코어 루프가 받는다: 잃지 않는다
  expect(calls.map((call) => call.last)).toEqual([{ kind: "user", message, requestId: "msg-1" }]);
  expect(t.queue.items.filter((item) => item.item === message)).toHaveLength(1);
  expect(t.host.leaseOf(thread)).toBeNull();
});

test("a message held for a start request that never becomes a frame goes back to the input queue", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  // 없는 scope의 시작 요청은 부여 경계에서 버려진다
  await t.host.openThread(thread, { startDrive: "no-such-scope" });
  const message: PostItem = { kind: "user", content: "nobody leads" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  expect(t.host.leaseOf(thread)).toBeNull();
  expect(t.queue.items.filter((item) => item.item === message)).toHaveLength(1);
});

test("claimUserInput is false when no drive lease is held", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const message: PostItem = { kind: "user", content: "hello" };
  // 대화를 아직 열지 않았다
  expect(await t.host.claimUserInput(t.newThread(), message)).toBe(false);

  const thread = t.newThread();
  await install(
    t,
    "user-none",
    stepOf([], () => ({ do: "done" })),
  );
  await t.host.openThread(thread);
  t.host.startDrive(thread, "user-none");
  await t.settled();
  // 단계 함수가 done으로 물러나 임대가 없다
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(await t.host.claimUserInput(thread, message)).toBe(false);
});

test("three steps after a user message without a turn or done give the lease back as revoked and hand the message to the input queue", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "user-hand-back",
    stepOf(calls, ({ last }) => (last === null ? { do: "yield" } : HANDOFF)),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "user-hand-back");
  await t.settled();

  const message: PostItem = { kind: "user", content: "wait, stop" };
  expect(await t.host.claimUserInput(thread, message, "msg-1")).toBe(true);
  await t.settled();

  // 사용자 메시지를 받은 단계 다음으로 세 단계를 더 부르고, 네 번째 다음 단계에서는 임대를 내린다.
  // 메시지는 한 번만 전달된다(반납 뒤 같은 scope의 새 임대는 `last`에 메시지를 다시 싣지 않는다)
  expect(calls.slice(0, 5).map((call) => call.last)).toEqual([
    null,
    { kind: "user", message, requestId: "msg-1" },
    REFUSED,
    REFUSED,
    REFUSED,
  ]);
  expect(calls.filter((call) => call.last?.kind === "user")).toHaveLength(1);
  const [grant] = acquiredOf(t, thread);
  if (grant === undefined) throw new Error("no lease.acquired");
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["revoked"]);
  expect(t.queue.items).toEqual([
    {
      threadId: thread,
      scopeId: "user-hand-back",
      requestId: "user-return:msg-1",
      when: "followUp",
      item: message,
    },
  ]);
});

test("eight effect-less commands in a row end the invoke with a scope notice, not a loop", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "chain-limit",
    stepOf(calls, () => HANDOFF),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "chain-limit");
  await t.settled();

  expect(calls).toHaveLength(8);
  expect(calls[0]?.last).toBeNull();
  expect(calls.slice(1).map((call) => call.last)).toEqual(Array.from({ length: 7 }, () => REFUSED));
  expect(t.diagnostics.filter((diagnostic) => diagnostic.code === "scope_notice")).toHaveLength(1);
  // 상한에서는 임대를 내리지 않고 다음 경계에 다시 묻는다
  expect(t.host.leaseOf(thread)).not.toBeNull();
  expect(t.loop.turns).toHaveLength(0);
});

test("a commit the store rejects as state_conflict arrives as a refused last", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "state-conflict",
    stepOf(calls, ({ last }) => {
      if (last !== null) return { do: "done" };
      // 상태 커밋 요청을 저장소가 판 충돌로 거부하게 한다. 다음 commit 하나만 거부된다
      t.records.failNext("state_conflict");
      return { do: "commit", state: { count: 1 }, next: { do: "yield" } };
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "state-conflict");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    { kind: "refused", code: "state_conflict" },
  ]);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toEqual([]);
  expect(settledOf(t, thread)).toEqual([]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

// ── 도구와 모델 명령(E2) ─────────────────────────────────────────────────

const TOOL_VIEW: ToolResultView = {
  content: "42",
  structuredContent: null,
  isError: false,
  details: null,
};

/** 제공자가 낸 답. 엔진은 `replayed`를 떼고 `text`, `usage`, `stopReason`만 단계 함수에 준다 */
function modelResult(input: number, output: number): PluginModelResult {
  return {
    text: "hi back",
    usage: { input, output, total: input + output },
    stopReason: "stop",
    replayed: false,
  };
}

const JUDGE: DriveCommand<Counter> = {
  do: "model",
  messages: [
    { role: "system", content: "Judge." },
    { role: "user", content: "Is it done?" },
  ],
  label: "judge",
  requestId: "model-1",
};

test("a tool command runs through ToolsPort as the drive's call, and its result comes back as the next last", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const tools = fakeTools(() => ok(TOOL_VIEW));
  await provideToolsPort(t, tools.port);
  const calls: Call[] = [];
  await install(
    t,
    "tool-ok",
    stepOf(calls, ({ last }) =>
      last === null
        ? { do: "tool", name: "read", args: { path: "a.txt" }, requestId: "tool-1" }
        : { do: "done" },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "tool-ok");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    { kind: "ok", of: "tool", value: TOOL_VIEW },
  ]);
  expect(tools.requests).toMatchObject([
    {
      threadId: thread,
      plugin: { name: "tool-ok", scopeId: "tool-ok" },
      via: "drive",
      target: { kind: "tool", name: "read" },
      input: { path: "a.txt" },
      requestId: "tool-1",
    },
  ]);
  expect(settledOf(t, thread)).toEqual([
    { scopeId: "tool-ok", requestId: "tool-1", command: "tool", outcome: "completed" },
  ]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

test("a restart that replays a tool command records no second drive.command_settled for it", async () => {
  const first = await createTestHost({ loop: SCRIPTED });
  await provideToolsPort(first, fakeTools(() => ok(TOOL_VIEW)).port);
  const thread = first.newThread();
  const step = stepOf([], ({ last }) =>
    last === null
      ? { do: "tool", name: "read", args: null, requestId: "tool-replay" }
      : { do: "yield" },
  );
  await install(first, "tool-replay", step);
  await first.host.openThread(thread);
  first.host.startDrive(thread, "tool-replay");
  await first.settled();
  const before = settledOf(first, thread);
  expect(before).toEqual([
    { scopeId: "tool-replay", requestId: "tool-replay", command: "tool", outcome: "completed" },
  ]);

  await first.host.closeThread(thread);
  const second = await first.restart();
  await provideToolsPort(second, fakeTools(() => ok(TOOL_VIEW)).port);
  await install(second, "tool-replay", step);
  await second.host.openThread(thread);
  await second.settled();

  expect(settledOf(second, thread)).toEqual(before);
});

/** ToolsPort가 준 실패가 단계 결과로 어떻게 옮겨지는가. 거부한 쪽이 없는 거부는 `refused`다 */
const TOOL_FAILURES: readonly [string, ToolError, StepResult, string][] = [
  [
    "a human denial",
    {
      kind: "denied",
      message: "[fresnel:denied_by_user] The user denied this call.",
      resolvedBy: "human",
    },
    { kind: "denied", by: "human", reason: "[fresnel:denied_by_user] The user denied this call." },
    "denied",
  ],
  [
    "a policy denial",
    {
      kind: "denied",
      message: '[fresnel:denied_by_policy] Tool call "write" is denied.',
      resolvedBy: "policy",
    },
    {
      kind: "denied",
      by: "policy",
      reason: '[fresnel:denied_by_policy] Tool call "write" is denied.',
    },
    "denied",
  ],
  [
    "a denial nobody decided (the approval was cancelled)",
    { kind: "denied", message: "[fresnel:cancelled] The approval was cancelled." },
    { kind: "refused", code: "denied" },
    "refused",
  ],
  [
    "a hook block",
    { kind: "blocked", message: "[fresnel:denied_by_extension] no reads today" },
    {
      kind: "blocked",
      by: { plugin: null, hook: null },
      reason: "[fresnel:denied_by_extension] no reads today",
    },
    "blocked",
  ],
  [
    "an abort",
    { kind: "aborted", message: "[fresnel:aborted] Operation aborted" },
    { kind: "aborted" },
    "aborted",
  ],
  [
    "an unknown tool",
    { kind: "unavailable", message: "[fresnel:tool_unavailable] write is not available." },
    { kind: "refused", code: "unavailable" },
    "refused",
  ],
  [
    "an unknown outcome",
    { kind: "unknown_outcome", message: "[fresnel:unknown_outcome] It may have taken effect." },
    { kind: "refused", code: "unknown_outcome" },
    "refused",
  ],
];

for (const [label, error, expected, outcome] of TOOL_FAILURES) {
  test(`${label} from ToolsPort comes back as the next last, is not thrown, and settles as ${outcome}`, async () => {
    const t = await createTestHost({ loop: SCRIPTED });
    await provideToolsPort(t, fakeTools(() => err(error)).port);
    const calls: Call[] = [];
    await install(
      t,
      "tool-failure",
      stepOf(calls, ({ last }) =>
        last === null
          ? { do: "tool", name: "write", args: {}, requestId: "tool-failed" }
          : { do: "done" },
      ),
    );
    const thread = t.newThread();
    await t.host.openThread(thread);
    t.host.startDrive(thread, "tool-failure");
    await t.settled();

    expect(calls.map((call) => call.last)).toEqual([null, expected]);
    expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
    expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
    expect(settledOf(t, thread).map((entry) => entry.outcome)).toEqual([outcome]);
  });
}

test("a tool command without fresnel.tools is refused as port_unavailable and the drive sees the refusal", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "tool-no-port",
    stepOf(calls, ({ last }) =>
      last === null ? { do: "tool", name: "read", args: null } : { do: "done" },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "tool-no-port");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    { kind: "refused", code: "port_unavailable" },
  ]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
  expect(settledOf(t, thread)).toEqual([]);
});

test("a model command returns the text and usage, deducts the tokens from the budget, and settles as model", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const models = fakeModels(() => ok(modelResult(6, 4)));
  await provideModelsPort(t, models.port);
  const calls: Call[] = [];
  const budgets: DriveLockBudget[] = [];
  const step: DriveStep<Counter> = (input) => {
    calls.push({ state: input.state, last: input.last });
    budgets.push(input.budget);
    return Promise.resolve(input.last === null ? JUDGE : { do: "done" });
  };
  await t.host.install(
    makeGroupUnit<Counter>({ name: "model-ok", def: COUNTER_DEF }, (g) => {
      g.drive(step, { limits: { maxTokens: 100 } });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "model-ok");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    {
      kind: "ok",
      of: "model",
      value: { text: "hi back", usage: { input: 6, output: 4, total: 10 }, stopReason: "stop" },
    },
  ]);
  // 두 번째 단계는 첫 호출의 토큰 10을 뺀 남은 예산을 본다
  expect(budgets.map((budget) => budget.tokens)).toEqual([100, 90]);
  expect(models.requests).toMatchObject([
    {
      threadId: thread,
      plugin: { name: "model-ok", scopeId: "model-ok" },
      requestId: "model-1",
      label: "judge",
      messages: [
        { role: "system", content: "Judge." },
        { role: "user", content: "Is it done?" },
      ],
    },
  ]);
  expect(settledOf(t, thread)).toEqual([
    { scopeId: "model-ok", requestId: "model-1", command: "model", outcome: "completed" },
  ]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

test("a model command after the token budget is spent releases the lease as budget, like a turn does", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const models = fakeModels(() => ok(modelResult(1, 0)));
  await provideModelsPort(t, models.port);
  const calls: Call[] = [];
  await installLimited(
    t,
    "model-budget",
    (input) => {
      calls.push({ state: input.state, last: input.last });
      return Promise.resolve(input.last === null ? JUDGE : { ...JUDGE, requestId: "model-2" });
    },
    { maxTokens: 1 },
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "model-budget");
  await t.settled();

  // 첫 호출이 토큰 1을 다 쓴다. 두 번째 명령은 호출되지 않고 임대가 budget으로 반납된다
  expect(calls.map((call) => call.last)).toEqual([
    null,
    {
      kind: "ok",
      of: "model",
      value: { text: "hi back", usage: { input: 1, output: 0, total: 1 }, stopReason: "stop" },
    },
  ]);
  expect(models.requests.map((request) => request.requestId)).toEqual(["model-1"]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["budget"]);
  expect(settledOf(t, thread).map((entry) => entry.requestId)).toEqual(["model-1"]);
});

const MODEL_FAILURES: readonly [string, PluginModelError, StepResult, string][] = [
  [
    "a guard denial",
    { kind: "denied_by_guard", message: "[fresnel:denied_by_guard] no model calls" },
    { kind: "refused", code: "denied_by_guard" },
    "refused",
  ],
  [
    "a provider error",
    { kind: "provider_error", message: "upstream exploded" },
    { kind: "refused", code: "provider_error" },
    "refused",
  ],
  ["an abort", { kind: "aborted", message: "aborted" }, { kind: "aborted" }, "aborted"],
];

for (const [label, error, expected, outcome] of MODEL_FAILURES) {
  test(`${label} from ModelsPort comes back as the next last, is not thrown, and settles as ${outcome}`, async () => {
    const t = await createTestHost({ loop: SCRIPTED });
    const models = fakeModels(() => err(error));
    await provideModelsPort(t, models.port);
    const calls: Call[] = [];
    await install(
      t,
      "model-failure",
      stepOf(calls, ({ last }) => (last === null ? JUDGE : { do: "done" })),
    );
    const thread = t.newThread();
    await t.host.openThread(thread);
    t.host.startDrive(thread, "model-failure");
    await t.settled();

    expect(calls.map((call) => call.last)).toEqual([null, expected]);
    expect(models.requests).toHaveLength(1);
    expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
    expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
    expect(settledOf(t, thread).map((entry) => entry.outcome)).toEqual([outcome]);
  });
}

const NOTHING_TO_SEND: readonly [
  string,
  readonly { role: "system" | "user" | "assistant"; content: string }[],
][] = [
  ["no messages", []],
  ["only a system message", [{ role: "system", content: "alone" }]],
];

for (const [label, messages] of NOTHING_TO_SEND) {
  test(`a model command with ${label} is refused as input_invalid without a provider call`, async () => {
    const t = await createTestHost({ loop: SCRIPTED });
    const models = fakeModels(() => ok(modelResult(6, 4)));
    await provideModelsPort(t, models.port);
    const calls: Call[] = [];
    await install(
      t,
      "model-empty",
      stepOf(calls, ({ last }) => (last === null ? { do: "model", messages } : { do: "done" })),
    );
    const thread = t.newThread();
    await t.host.openThread(thread);
    t.host.startDrive(thread, "model-empty");
    await t.settled();

    expect(calls.map((call) => call.last)).toEqual([
      null,
      { kind: "refused", code: "input_invalid" },
    ]);
    expect(models.requests).toEqual([]);
    expect(settledOf(t, thread)).toEqual([]);
  });
}

test("a model command without fresnel.models is refused as port_unavailable and the drive sees the refusal", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "model-no-port",
    stepOf(calls, ({ last }) => (last === null ? MODEL : { do: "done" })),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "model-no-port");
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([
    null,
    { kind: "refused", code: "port_unavailable" },
  ]);
  expect(settledOf(t, thread)).toEqual([]);
});

test("failed model calls are not effects, so a chain of them ends at the chain limit with a scope notice", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const models = fakeModels(() =>
    err({ kind: "denied_by_guard", message: "[fresnel:denied_by_guard] no model calls" }),
  );
  await provideModelsPort(t, models.port);
  const calls: Call[] = [];
  await install(
    t,
    "model-chain",
    stepOf(calls, () => MODEL),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "model-chain");
  await t.settled();

  expect(calls).toHaveLength(MAX_CHAINED_REINVOKES);
  expect(models.requests).toHaveLength(MAX_CHAINED_REINVOKES);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.code === "scope_notice")).toHaveLength(1);
  expect(t.host.leaseOf(thread)).not.toBeNull();
});

test("successful tool commands are effects, so a run longer than the chain limit is not cut", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const tools = fakeTools(() => ok(TOOL_VIEW));
  await provideToolsPort(t, tools.port);
  const calls: Call[] = [];
  await install(
    t,
    "tool-run",
    stepOf(calls, () =>
      calls.length >= MAX_CHAINED_REINVOKES + 2
        ? { do: "done" }
        : { do: "tool", name: "read", args: null },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "tool-run");
  await t.settled();

  expect(calls).toHaveLength(MAX_CHAINED_REINVOKES + 2);
  expect(tools.requests).toHaveLength(MAX_CHAINED_REINVOKES + 1);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.code === "scope_notice")).toEqual([]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

test("a step function that only issues tool commands is ended by the tool command limit as budget", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const tools = fakeTools(() => ok(TOOL_VIEW));
  await provideToolsPort(t, tools.port);
  const calls: Call[] = [];
  await install(
    t,
    "tool-forever",
    stepOf(calls, () => ({ do: "tool", name: "read", args: null })),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "tool-forever");
  await t.settled();

  // 상한만큼 실행하고 다음 명령은 부르지 않은 채 임대가 budget으로 반납된다
  expect(tools.requests).toHaveLength(MAX_DRIVE_TOOL_COMMANDS);
  expect(calls).toHaveLength(MAX_DRIVE_TOOL_COMMANDS + 1);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["budget"]);
});

test("tokens that a hook's agents.judge or models.complete spent are deducted from the top frame's budget", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const models = fakeModels(() => ok(modelResult(6, 4)));
  await provideModelsPort(t, models.port);
  const budgets: DriveLockBudget[] = [];
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit<Counter>({ name: "charged", def: COUNTER_DEF }, (g) => {
      g.drive(
        (input) => {
          budgets.push(input.budget);
          if (input.last !== null) return Promise.resolve({ do: "done" });
          // 훅이 쓴 토큰 30이 이 프레임에서 빠진다(재생이 아닌 호출만 부른다)
          t.host.chargeDriveTokens(thread, 30);
          return Promise.resolve(JUDGE);
        },
        { limits: { maxTokens: 100 } },
      );
    }),
  );
  await t.host.openThread(thread);
  t.host.startDrive(thread, "charged");
  await t.settled();

  // 두 번째 단계는 훅 30과 model 명령 10을 뺀 남은 예산을 본다
  expect(budgets.map((budget) => budget.tokens)).toEqual([100, 60]);
});

/** 한도를 준 그룹 하나를 설치한다. 단계 함수는 `step`이다 */
async function installLimited(
  t: Host,
  name: string,
  step: DriveStep<Counter>,
  limits: DriveLimits,
): Promise<void> {
  await t.host.install(
    makeGroupUnit<Counter>({ name, def: COUNTER_DEF }, (g) => {
      g.drive(step, { limits });
    }),
  );
}
