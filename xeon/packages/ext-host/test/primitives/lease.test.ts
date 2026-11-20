import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveCommand } from "@fresnel/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeOrchestrationUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

/** 상태가 없는 그룹의 명령(S가 never). 상태가 있는 그룹의 단계 함수에도 그대로 들어간다 */
type Command = DriveCommand<never>;

function turnOf(content: string): Command {
  return { do: "turn", input: { kind: "user", content } };
}

function yieldOf(): Command {
  return { do: "yield" };
}

function doneOf(): Command {
  return { do: "done" };
}

/** 사용자 명령으로 주도 시작을 요청하고 거부가 없었는지 확인한다 */
function requestDrive(t: Host, thread: ThreadId, scopeId: string): void {
  expect(t.host.startDrive(thread, scopeId)).toEqual({ ok: true, value: undefined });
}

/** 첫 단계에서 `name`을 기록하고 turn을 하나 낸다. turn 결과를 받은 단계는 끝낸다 */
function installDriveGroups(t: Host, names: readonly string[], calls: string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeOrchestrationUnit({ name, loadIndex }, (g) => {
        g.drive(({ last }) => {
          if (last === null) calls.push(name);
          return Promise.resolve(last === null ? turnOf(name) : yieldOf());
        });
      }),
    );
    return "continue";
  });
}

function kinds(t: Host, thread: ThreadId, kind: string): readonly unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === kind)
    .map((event) => event.payload);
}

test("a group released as idle is granted again only by a new start request", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let invocations = 0;
  await t.host.install(
    makeOrchestrationUnit({ name: "ls-idle" }, (g) => {
      g.drive(() => {
        invocations += 1;
        return Promise.resolve(yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-idle");
  await t.settled();
  // 효과 없이 같은 판으로 두 번 반환하면 idle로 반납된다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([{ reason: "idle" }]);
  expect(t.host.leaseOf(thread)).toBeNull();
  const acquiredAfterIdle = kinds(t, thread, "lease.acquired").length;
  // 정착과 유휴 경계만으로는 다시 부여하지 않는다
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(acquiredAfterIdle);
  expect(invocations).toBe(2);
  // 새 시작 요청이 있어야 다시 부여된다
  requestDrive(t, thread, "ls-idle");
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(acquiredAfterIdle + 1);
  expect(invocations).toBe(3);
});

test("a child conversation gets no drive lease and its drive function never runs", async () => {
  const t = await createTestHost();
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-child"], calls);
  const child = t.newThread();
  // 자식 대화는 시작 요청을 받아도 임대를 받지 않는다
  await t.host.openThread(child, { child: true, startDrive: "ls-child" });
  await t.settled();
  expect(t.host.startDrive(child, "ls-child")).toEqual({
    ok: false,
    error: { kind: "child_thread" },
  });
  await t.boundary(child).turnSettled();
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.host.leaseOf(child)).toBeNull();
  expect(kinds(t, child, "lease.acquired")).toEqual([]);
  // 같은 호스트의 주 대화는 임대를 받는다
  const main = t.newThread();
  await t.host.openThread(main);
  await t.settled();
  t.host.startDrive(main, "ls-child");
  await t.settled();
  expect(calls).toEqual(["ls-child"]);
  expect(kinds(t, main, "lease.acquired")).toMatchObject([{ scopeId: "ls-child" }]);
});

const OpenSchema = Type.Object({ open: Type.Boolean() }, { additionalProperties: false });

test("a drive that returns done is released as done and is not granted again without a new start request", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeOrchestrationUnit(
      {
        name: "ls-lazy",
        def: { state: { schema: OpenSchema, initial: { open: false }, version: 1 } },
      },
      (g) => {
        g.drive(({ state }) => {
          calls.push("ls-lazy");
          return Promise.resolve(state.open ? yieldOf() : doneOf());
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-lazy");
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([
    { scopeId: "ls-lazy", reason: "done" },
  ]);
  expect(t.host.leaseOf(thread)).toBeNull();
  // 다음 경계가 와도 시작 요청이 없으므로 같은 그룹을 다시 주지 않는다
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(calls).toEqual(["ls-lazy"]);
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(1);
  // 새 시작 요청이 오면 다시 부여되고, 상태가 그대로라 다시 done으로 물러난다
  requestDrive(t, thread, "ls-lazy");
  await t.settled();
  expect(calls).toEqual(["ls-lazy", "ls-lazy"]);
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(2);
  expect(kinds(t, thread, "lease.released")).toHaveLength(2);
});

test("a start request made while the drive ahead is running waits and takes the stack when that drive returns done", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  // 앞 단계 함수가 도는 동안 요청한다(실행 중이면 사용자 명령은 단계 경계까지 기다린다). 시작과 풀기 신호로 그 순간을 고정한다
  const started = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  await t.host.install(
    makeOrchestrationUnit(
      {
        name: "ls-lazy",
        def: { state: { schema: OpenSchema, initial: { open: false }, version: 1 } },
      },
      (g) => {
        g.drive(async ({ state }) => {
          started.resolve();
          await unblock.promise;
          return state.open ? yieldOf() : doneOf();
        });
      },
    ),
  );
  await t.host.install(
    makeOrchestrationUnit({ name: "ls-busy", loadIndex: 1 }, (g) => {
      g.drive(({ last }) => {
        if (last === null) calls.push("ls-busy");
        return Promise.resolve(last === null ? turnOf("busy") : yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-lazy");
  await started.promise;
  // 앞 단계가 도는 동안 뒤 요청은 큐에 남고 스택을 바꾸지 않는다. 앞 단계가 done으로 물러나 스택이 비면 부여된다
  requestDrive(t, thread, "ls-busy");
  expect(calls).toEqual([]);
  unblock.resolve();
  await t.settled();
  expect(calls).toEqual(["ls-busy"]);
  expect(kinds(t, thread, "lease.released")).toMatchObject([
    { scopeId: "ls-lazy", reason: "done" },
  ]);
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "ls-lazy" },
    { scopeId: "ls-busy" },
  ]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-busy", status: "active" });
});

test("a drive whose state is open runs and takes the lock", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeOrchestrationUnit(
      {
        name: "ls-open",
        def: { state: { schema: OpenSchema, initial: { open: true }, version: 1 } },
      },
      (g) => {
        g.drive(({ state, last }) => {
          if (!state.open) return Promise.resolve(doneOf());
          if (last === null) calls.push("ls-open");
          return Promise.resolve(yieldOf());
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-open");
  await t.settled();
  expect(calls).toEqual(["ls-open"]);
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([{ scopeId: "ls-open" }]);
});

test("drive limits are read from the options getter when a lease is taken, so a change applies to the next lease", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let maxTurns = 2;
  await t.host.install(
    makeOrchestrationUnit({ name: "ls-limits" }, (g) => {
      g.drive(() => Promise.resolve(yieldOf()), {
        get limits() {
          return { maxTurns };
        },
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-limits");
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "ls-limits", limits: { maxTurns: 2 } },
  ]);
  // 효과 없이 반환하면 idle로 반납된다(위 idle 테스트와 같은 순서)
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([{ reason: "idle" }]);
  // 등록 뒤에 바뀐 값은 다음 임대부터 반영된다
  maxTurns = 5;
  requestDrive(t, thread, "ls-limits");
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "ls-limits", limits: { maxTurns: 2 } },
    { scopeId: "ls-limits", limits: { maxTurns: 5 } },
  ]);
});

test("a user interrupt releases the lease as revoked and the drive is not called again until a user start request", async () => {
  const t = await createTestHost();
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-stop"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  t.host.startDrive(thread, "ls-stop");
  await t.settled();
  expect(calls).toEqual(["ls-stop"]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-stop", status: "active" });

  await t.boundary(thread).turnSettled({ userInterrupted: true });
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([
    { scopeId: "ls-stop", reason: "revoked" },
  ]);
  expect(t.host.leaseOf(thread)).toBeNull();
  // 같은 경계와 이어지는 유휴 경계에서도 다시 부여되지 않는다
  await t.boundary(thread).idle();
  await t.settled();
  expect(calls).toEqual(["ls-stop"]);
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(1);

  // 사용자가 다시 명령하면 주도가 다시 시작된다
  requestDrive(t, thread, "ls-stop");
  await t.settled();
  expect(calls).toEqual(["ls-stop", "ls-stop"]);
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(2);
});
