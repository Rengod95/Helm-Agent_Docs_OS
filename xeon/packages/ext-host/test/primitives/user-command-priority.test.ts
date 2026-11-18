// 사용자 명령의 주도 전환(drive-isolation.md 2.2)과 사용자 개입(2.4). 실행 중인 단계는 끊지 않고 단계 경계에서 스택 전체를
// 내린다. 유휴와 질문 대기에서는 바로 바꾼다. 전환 정책은 switch-policy.ts 한 곳에 있다. 승인과 기록, 루프는 대역이다.
import { expect, test } from "bun:test";
import type { AskCard, DriveCommand, PostItem, StepResult } from "@fresnel/contracts/extensions";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import {
  shouldSwitchNow,
  USER_SWITCH_AT,
  type SwitchSituation,
} from "../../src/primitives/switch-policy.ts";
import {
  acquiredOf,
  fakeApprovals,
  provideApprovals,
  releasedOf,
  type Host,
} from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

type Command = DriveCommand<never>;

const ids = fixedIdFactory(9000);
const TURN = ids.next("trn");

const GO: Command = { do: "turn", input: { kind: "user", content: "go" } };
const YIELD: Command = { do: "yield" };
const DONE: Command = { do: "done" };
const MESSAGE: PostItem = { kind: "user", content: "wait, one more thing" };
const UNHANDLED: Command = { do: "handoff", to: "nobody", input: "x" };
/** 없는 대상에 `handoff`를 내면 받는 거부 결과(`model`, `tool`은 실행되므로 거부 예시는 `handoff`다) */
const REFUSED: StepResult = { kind: "refused", code: "target_unavailable" };

const CARD: AskCard = {
  questions: [
    {
      id: "q1",
      header: "Go",
      text: "Go?",
      options: [{ id: "yes", label: "Yes" }],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

/** 턴 하나를 풀릴 때까지 붙잡는 루프. `started`는 턴이 도는 순간을 알리고 `unblock`은 턴을 끝낸다 */
function gatedLoop(): {
  readonly options: MemoryLoopOptions;
  readonly started: PromiseWithResolvers<void>;
  readonly unblock: PromiseWithResolvers<void>;
} {
  const started = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  return {
    options: {
      runTurn: async () => {
        started.resolve();
        await unblock.promise;
        return { outcome: { turnId: TURN, status: "completed" }, usage: null };
      },
    },
    started,
    unblock,
  };
}

/** 진단 `scope_notice`의 문구만 받은 순서대로 */
function noticesOf(t: Host): string[] {
  return t.diagnostics
    .filter((diagnostic) => diagnostic.code === "scope_notice")
    .map((diagnostic) => diagnostic.message);
}

/** 단계 함수가 불린 `last`를 기록하는 단계 함수 하나 */
function recordingStep(
  calls: (StepResult | null)[],
  decide: (last: StepResult | null) => Command,
): (input: { readonly last: StepResult | null }) => Promise<Command> {
  return ({ last }) => {
    calls.push(last);
    return Promise.resolve(decide(last));
  };
}

test("the switch policy switches at a step end, while idle, and while asking under the default, and never mid-step", () => {
  expect(USER_SWITCH_AT).toBe("step_boundary");
  const running: SwitchSituation = { running: true, asking: false, stepEnded: false };
  expect(shouldSwitchNow(running)).toBe(false);
  expect(shouldSwitchNow({ ...running, stepEnded: true })).toBe(true);
  expect(shouldSwitchNow({ running: false, asking: false, stepEnded: false })).toBe(true);
  expect(shouldSwitchNow({ running: true, asking: true, stepEnded: false })).toBe(true);
  // task_end: 맡은 일이 스스로 끝나기 전에는 어떤 자리에서도 바꾸지 않는다
  for (const situation of [
    running,
    { ...running, stepEnded: true },
    { running: false, asking: false, stepEnded: false },
    { running: true, asking: true, stepEnded: false },
  ]) {
    expect(shouldSwitchNow(situation, "task_end")).toBe(false);
  }
});

test("a user command during a running turn waits for the turn, the step ends, the stack is revoked and the new driver takes over with one notice", async () => {
  const gate = gatedLoop();
  const t = await createTestHost({ loop: gate.options });
  const thread = t.newThread();
  const aCalls: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(recordingStep(aCalls, (last) => (last === null ? GO : YIELD)));
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(YIELD));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await gate.started.promise;

  // 턴이 도는 동안의 사용자 명령은 큐에만 남는다. 진행 중인 턴을 끊지 않는다
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(releasedOf(t, thread)).toEqual([]);

  // 턴이 끝나고 그 단계가 끝나는 경계에서 스택 전체를 내리고 새 주도를 부여한다
  gate.unblock.resolve();
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);
  expect(aCalls).toEqual([null]);
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(noticesOf(t)).toEqual(["frame-a 주도를 frame-b으로 바꿨다(사용자 명령)"]);
});

test("a user command while the driver is idle switches the stack at once", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const aCalls: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(recordingStep(aCalls, () => YIELD));
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(YIELD));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await t.settled();
  // 첫 단계가 yield로 끝나 유휴다(실행 중이 아니다)
  expect(aCalls).toEqual([null]);

  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(aCalls).toEqual([null]);
  expect(noticesOf(t)).toHaveLength(1);
});

test("a user command while the driver waits for an answer takes the stack at once and the wait ends as revoked", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const thread = t.newThread();
  const aCalls: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(
        recordingStep(aCalls, (last) =>
          last === null ? { do: "ask", card: CARD, requestId: "q1" } : DONE,
        ),
      );
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(YIELD));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await t.settled();
  expect(t.host.driveFrames(thread).map((frame) => frame.state)).toEqual(["driving", "asking"]);

  // 질문 대기는 기다림을 끊고 바로 전환한다. 승인은 닫지 않는다(사용자의 것이다)
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(aCalls).toEqual([null]);
  expect(approvals.created).toHaveLength(1);
  expect(approvals.cancelled).toEqual([]);
});

test("a user command for the scope that already leads is dropped with a notice and does not restart it", async () => {
  const gate = gatedLoop();
  const t = await createTestHost({ loop: gate.options });
  const thread = t.newThread();
  const aCalls: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(recordingStep(aCalls, (last) => (last === null ? GO : YIELD)));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await gate.started.promise;

  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  gate.unblock.resolve();
  await t.settled();

  // 같은 scope의 명령은 전환이 아니다. 주도는 그대로 이어지고 명령은 버려진다
  expect(releasedOf(t, thread)).toEqual([]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(aCalls).toEqual([
    null,
    { kind: "ok", of: "turn", value: { turnId: TURN, status: "completed" } },
  ]);
  expect(noticesOf(t)).toEqual([
    "drive start of frame-a was dropped: the scope already leads this conversation",
  ]);
});

test("a stop during a running turn revokes the whole stack and empties the queue, so the queued command does not start by itself", async () => {
  const gate = gatedLoop();
  const t = await createTestHost({ loop: gate.options });
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(() => Promise.resolve(GO));
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(YIELD));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await gate.started.promise;
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);

  // 사용자가 턴을 멈춘 경계: 스택 전체를 내리고 시작 요청 큐를 비운다
  await t.boundary(thread).turnSettled({ userInterrupted: true });
  gate.unblock.resolve();
  await t.settled();
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(t.host.driveFrames(thread)).toHaveLength(1);

  // 큐가 비었으므로 frame-b는 저절로 시작하지 않는다. 사용자의 다음 명령이 시작한다
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
});

test("a user message held by a driver that is revoked goes back to the input queue", async () => {
  const gate = gatedLoop();
  const t = await createTestHost({ loop: gate.options });
  const thread = t.newThread();
  // 첫 단계는 yield로 끝나 주도가 engaged가 된다. 두 번째 단계의 턴이 도는 동안 사용자 메시지를 받는다
  let calls = 0;
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(() => {
        calls += 1;
        return Promise.resolve(calls === 1 ? YIELD : GO);
      });
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(YIELD));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await t.settled();
  await t.boundary(thread).turnSettled();
  await gate.started.promise;

  expect(t.host.claimUserInput(thread, MESSAGE)).toBe(true);
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  gate.unblock.resolve();
  await t.settled();

  // 메시지는 단계 함수에 전달되지 않고 코어 루프의 입력 큐로 돌아간다. 주도는 전환되었다
  expect(t.queue.items).toMatchObject([{ scopeId: "frame-a", when: "followUp", item: MESSAGE }]);
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
});

test("a user message the top frame does not answer in three steps revokes the whole stack and returns the message to the input queue", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(({ last }) =>
        Promise.resolve(last === null ? { do: "handoff", to: "frame-b", input: "x" } : DONE),
      );
    }),
  );
  const bCalls: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      // 사용자 메시지에 답하지 않는다: 없는 대상에 맡기는 명령은 이 자리에서 거부 결과가 된다
      g.drive(recordingStep(bCalls, (last) => (last === null ? YIELD : UNHANDLED)));
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "frame-a");
  await t.settled();
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);

  // 맨 위(B)가 유휴인 동안 온 사용자 메시지는 B에게 전달된다. 세 단계 안에 처리하지 못하면 스택 전체를 내린다
  expect(t.host.claimUserInput(thread, MESSAGE)).toBe(true);
  await t.settled();
  expect(bCalls.slice(0, 5)).toEqual([
    null,
    { kind: "user", message: MESSAGE },
    REFUSED,
    REFUSED,
    REFUSED,
  ]);
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "revoked"],
    ["frame-a", "revoked"],
  ]);
  expect(t.host.driveFrames(thread)).toHaveLength(1);
  expect(t.queue.items).toMatchObject([{ scopeId: "frame-b", when: "followUp", item: MESSAGE }]);
});
