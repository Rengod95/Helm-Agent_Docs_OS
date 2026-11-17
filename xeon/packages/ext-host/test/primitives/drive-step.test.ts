// 주도 단계 함수를 실제 호스트와 drive 락 중재자 위에서 돌린다. 명령이 이어지는 순서, 기본 요청 id와 재시작 재실행,
// 명시 id, done·yield·idle 반납, 아직 없는 명령의 거부 결과, drive.command_settled 사건, 사용자 메시지 전달, 효과 없는 명령의 상한,
// state_conflict 거부를 본다. 승인 서비스, 기록 저장소, 루프는 대역이다.
import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  AskCard,
  DriveCommand,
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
const REFUSED: StepResult = { kind: "refused", code: "command_unavailable" };
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
  await t.host.openThread(thread, { startDrive: "step-chain" });
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
  await first.host.openThread(thread, { startDrive: "rerun-default-key" });
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
  await t.host.openThread(thread, { startDrive: "explicit-key" });
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
  await t.host.openThread(thread, { startDrive: "done-scope" });
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
  await t.host.openThread(thread, { startDrive: "yield-idle" });
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

// `handoff`는 3b에서 구현됐다(handoff-stack.test.ts). 아직 없는 명령만 거부 결과를 받는다
const unavailable: readonly [string, DriveCommand<Counter>][] = [
  ["model", MODEL],
  ["tool", { do: "tool", name: "read", args: { path: "a" } }],
];

for (const [label, command] of unavailable) {
  test(`a ${label} command is refused as command_unavailable in the next last and is not thrown`, async () => {
    const t = await createTestHost({ loop: SCRIPTED });
    const calls: Call[] = [];
    await install(
      t,
      `refuse-${label}`,
      stepOf(calls, ({ last }) => (last === null ? command : { do: "done" })),
    );
    const thread = t.newThread();
    await t.host.openThread(thread, { startDrive: `refuse-${label}` });
    await t.settled();

    expect(calls.map((call) => call.last)).toEqual([null, REFUSED]);
    // 예외였다면 임대가 error로 반납되었을 것이다
    expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
    expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
    expect(t.loop.turns).toHaveLength(0);
  });
}

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
  await t.host.openThread(thread, { startDrive: "settle-events" });
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
  await first.host.openThread(thread, { startDrive: "settle-replay" });
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
  await t.host.openThread(thread, { startDrive: "user-turn" });
  await t.settled();

  const message: PostItem = { kind: "user", content: "stop the lens" };
  expect(t.host.claimUserInput(thread, message)).toBe(true);
  await t.settled();

  expect(calls.map((call) => call.last)).toEqual([null, { kind: "user", message }, TURN_RESULT]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.leaseOf(thread)).not.toBeNull();
});

test("claimUserInput is false when no drive lease is held", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const message: PostItem = { kind: "user", content: "hello" };
  // 대화를 아직 열지 않았다
  expect(t.host.claimUserInput(t.newThread(), message)).toBe(false);

  const thread = t.newThread();
  await install(
    t,
    "user-none",
    stepOf([], () => ({ do: "done" })),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 단계 함수가 done으로 물러나 임대가 없다
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(t.host.claimUserInput(thread, message)).toBe(false);
});

test("three steps after a user message without a turn or done give the lease back as revoked and hand the message to the input queue", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(
    t,
    "user-hand-back",
    stepOf(calls, ({ last }) => (last === null ? { do: "yield" } : MODEL)),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "user-hand-back" });
  await t.settled();

  const message: PostItem = { kind: "user", content: "wait, stop" };
  expect(t.host.claimUserInput(thread, message)).toBe(true);
  await t.settled();

  // 사용자 메시지를 받은 단계 다음으로 세 단계를 더 부르고, 네 번째 다음 단계에서는 임대를 내린다.
  // 메시지는 한 번만 전달된다(반납 뒤 같은 scope의 새 임대는 `last`에 메시지를 다시 싣지 않는다)
  expect(calls.slice(0, 5).map((call) => call.last)).toEqual([
    null,
    { kind: "user", message },
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
      requestId: `user-return:${grant.leaseId}:0`,
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
    stepOf(calls, () => MODEL),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "chain-limit" });
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
  await t.host.openThread(thread, { startDrive: "state-conflict" });
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
