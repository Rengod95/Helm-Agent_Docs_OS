// AGE-64: 프로필 전환이 시작 Drive를 맞춘다(`ExtHost.switchStartDrive`). 메시지를 받지 않은 프로필 시작 프레임만 내리고,
// 이미 일하는 프레임과 사용자가 시작한 프레임은 내리지 않는다. 누가 쥐었는지는 `leaseOf`와 `lease.acquired`·`lease.released` 기록으로 본다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  DriveCommand,
  DriveStep,
  DriveStepInput,
  PostItem,
  StepResult,
} from "@fresnel/contracts/extensions";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

const ids = fixedIdFactory(7000);
const TURN = ids.next("trn");
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
};

type Command = DriveCommand<never>;
interface Call {
  readonly name: string;
  readonly last: StepResult | null;
}

/** 첫 단계는 yield, 사용자 메시지를 받으면 turn으로 넘기고, `finish`가 참이면 끝낸다 */
function stepOf(calls: Call[], name: string, finish: () => boolean): DriveStep<never> {
  return (input: DriveStepInput<never>) => {
    calls.push({ name, last: input.last });
    if (finish()) return Promise.resolve<Command>({ do: "done" });
    if (input.last?.kind === "user") {
      return Promise.resolve<Command>({ do: "turn", input: input.last.message });
    }
    return Promise.resolve<Command>({ do: "yield" });
  };
}

async function install(t: Host, name: string, step: DriveStep<never>): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(step);
    }),
  );
}

function leaderOf(t: Host, thread: ThreadId): string | null {
  return t.host.leaseOf(thread)?.scopeId ?? null;
}

const never = (): boolean => false;
const HELLO: PostItem = { kind: "user", content: "hello" };

async function rig(opts: { finishA?: () => boolean } = {}): Promise<{
  t: Host;
  thread: ThreadId;
  calls: Call[];
}> {
  const t = await createTestHost({ loop: SCRIPTED });
  const calls: Call[] = [];
  await install(t, "drv-a", stepOf(calls, "drv-a", opts.finishA ?? never));
  await install(t, "drv-b", stepOf(calls, "drv-b", never));
  const thread = t.newThread();
  return { t, thread, calls };
}

test("before the first message, switching with no start drive held requests the new one and it leads", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.switchStartDrive(thread, "drv-b", true)).toEqual({ ok: true, value: "requested" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-b");
});

test("before the first message, an untouched start drive of the old profile is replaced by the new profile's", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread, { startDrive: "drv-a" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-a");
  expect(t.host.switchStartDrive(thread, "drv-b", true)).toEqual({ ok: true, value: "requested" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-b");
  expect(releasedOf(t, thread).map((item) => [item.scopeId, item.reason])).toEqual([
    ["drv-a", "revoked"],
  ]);
  expect(acquiredOf(t, thread).map((item) => item.scopeId)).toEqual(["drv-a", "drv-b"]);
});

test("switching to the start drive that already leads changes nothing", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread, { startDrive: "drv-a" });
  await t.settled();
  expect(t.host.switchStartDrive(thread, "drv-a", true)).toEqual({ ok: true, value: "leading" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-a");
  expect(releasedOf(t, thread)).toEqual([]);
});

test("switching to a profile without a start drive lowers an untouched start drive", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread, { startDrive: "drv-a" });
  await t.settled();
  expect(t.host.switchStartDrive(thread, null, true)).toEqual({ ok: true, value: "none" });
  await t.settled();
  expect(leaderOf(t, thread)).toBeNull();
  expect(releasedOf(t, thread).map((item) => [item.scopeId, item.reason])).toEqual([
    ["drv-a", "revoked"],
  ]);
});

test("a start drive that already took a message is kept, and the new start drive begins after it ends", async () => {
  let finishA = false;
  const { t, thread, calls } = await rig({ finishA: () => finishA });
  await t.host.openThread(thread, { startDrive: "drv-a" });
  await t.settled();
  expect(await t.host.claimUserInput(thread, HELLO, "msg-1")).toBe(true);
  await t.settled();
  expect(calls[0]).toEqual({
    name: "drv-a",
    last: { kind: "user", message: HELLO, requestId: "msg-1" },
  });
  expect(t.host.switchStartDrive(thread, "drv-b", false)).toEqual({ ok: true, value: "deferred" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-a");
  expect(releasedOf(t, thread)).toEqual([]);
  // 일이 끝나면 새 시작 Drive가 메시지 없이 바로 첫 단계를 돈다
  finishA = true;
  expect(await t.host.claimUserInput(thread, { kind: "user", content: "more" }, "msg-2")).toBe(
    true,
  );
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-b");
  expect(releasedOf(t, thread).map((item) => [item.scopeId, item.reason])).toEqual([
    ["drv-a", "done"],
  ]);
  expect(calls.find((call) => call.name === "drv-b")?.last).toBeNull();
});

test("after the first message with a rest thread, the new start drive begins right away without waiting for a message", async () => {
  const { t, thread, calls } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.switchStartDrive(thread, "drv-b", false)).toEqual({
    ok: true,
    value: "requested",
  });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-b");
  expect(calls.map((call) => [call.name, call.last])).toEqual([["drv-b", null]]);
});

test("while a core-loop turn runs, the new start drive waits and begins once the turn ends", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  t.loop.setRunning(thread, true);
  expect(t.host.switchStartDrive(thread, "drv-b", false)).toEqual({ ok: true, value: "deferred" });
  await t.settled();
  expect(leaderOf(t, thread)).toBeNull();
  expect(acquiredOf(t, thread)).toEqual([]);
  t.loop.setRunning(thread, false);
  await t.boundary(thread).idle();
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-b");
});

test("a message sent while the start waits for a turn goes to the core loop, not to the waiting start drive", async () => {
  const { t, thread, calls } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  t.loop.setRunning(thread, true);
  t.host.switchStartDrive(thread, "drv-b", false);
  expect(await t.host.claimUserInput(thread, HELLO, "msg-1")).toBe(false);
  t.loop.setRunning(thread, false);
  await t.boundary(thread).idle();
  await t.settled();
  expect(calls.map((call) => [call.name, call.last])).toEqual([["drv-b", null]]);
});

test("only the last of several switches stays valid", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  t.loop.setRunning(thread, true);
  t.host.switchStartDrive(thread, "drv-a", false);
  t.host.switchStartDrive(thread, "drv-b", false);
  t.loop.setRunning(thread, false);
  await t.boundary(thread).idle();
  await t.settled();
  expect(acquiredOf(t, thread).map((item) => item.scopeId)).toEqual(["drv-b"]);
  // 전환 하나가 걸려 있다가 시작 Drive가 없는 프로필로 바뀌면 시작하지 않는다
  const other = t.newThread();
  await t.host.openThread(other);
  await t.settled();
  t.loop.setRunning(other, true);
  t.host.switchStartDrive(other, "drv-a", false);
  expect(t.host.switchStartDrive(other, null, false)).toEqual({ ok: true, value: "none" });
  t.loop.setRunning(other, false);
  await t.boundary(other).idle();
  await t.settled();
  expect(acquiredOf(t, other)).toEqual([]);
});

test("a drive the user started is not lowered by a switch; the new start waits", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "drv-a");
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-a");
  expect(t.host.switchStartDrive(thread, "drv-b", false)).toEqual({ ok: true, value: "deferred" });
  await t.settled();
  expect(leaderOf(t, thread)).toBe("drv-a");
  expect(releasedOf(t, thread)).toEqual([]);
});

test("a start of the same scope as the wait is not duplicated by a repeated switch", async () => {
  const { t, thread } = await rig();
  await t.host.openThread(thread);
  await t.settled();
  t.loop.setRunning(thread, true);
  t.host.switchStartDrive(thread, "drv-b", false);
  t.host.switchStartDrive(thread, "drv-b", false);
  t.loop.setRunning(thread, false);
  await t.boundary(thread).idle();
  await t.settled();
  expect(acquiredOf(t, thread).map((item) => item.scopeId)).toEqual(["drv-b"]);
});
