import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  DriveLockArbiterPortKey,
  type DriveCommand,
  type DriveLockCandidate,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import type { PlatformModule } from "../../src/primitives/index.ts";
import {
  createStaticPrimitivesSettings,
  type PrimitivesSettingsSource,
} from "../../src/primitives/settings.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeGroupUnit, snapshotOf } from "./fixtures/support.ts";

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

/** 한 호출의 첫 단계에서 `name`을 기록하고 turn을 하나 낸다. turn 결과를 받은 단계는 끝낸다 */
function installDriveGroups(t: Host, names: readonly string[], calls: string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeGroupUnit({ name, loadIndex }, (g) => {
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

test("the arbiter port picks the holder and receives every eligible candidate", async () => {
  const t = await createTestHost();
  const seen: (readonly DriveLockCandidate[])[] = [];
  await t.host.registerPlatform({
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(DriveLockArbiterPortKey, {
        choose(_threadId, candidates) {
          seen.push(candidates);
          return candidates.find((candidate) => candidate.scopeId === "ls-b")?.scopeId ?? null;
        },
      });
    },
  });
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-a", "ls-b", "ls-c"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual(["ls-b"]);
  expect(seen[0]?.map((candidate) => candidate.scopeId)).toEqual(["ls-a", "ls-b", "ls-c"]);
  expect(seen[0]?.[1]).toMatchObject({ extension: "ls-b", loadIndex: 1, defaultEnabled: true });
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([{ scopeId: "ls-b" }]);
  // 임대가 있는 동안에는 중재자를 다시 묻지 않는다
  const asked = seen.length;
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen).toHaveLength(asked);
});

test("an arbiter that returns null leaves the thread without a lease", async () => {
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(DriveLockArbiterPortKey, { choose: (): RegistrationId | null => null });
    },
  });
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-n1"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.host.leaseOf(thread)).toBeNull();
});

test("choosing another drive group revokes the current lease and grants the chosen one", async () => {
  let chosen: RegistrationId | null = "ls-one";
  const base = createStaticPrimitivesSettings();
  const source: PrimitivesSettingsSource = {
    ...base,
    activeDriver: () => chosen,
  };
  const t = await createTestHost({ settingsSource: source });
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-one", "ls-two"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual(["ls-one"]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-one" });

  const changes: string[] = [];
  t.host.onChange((change) => {
    changes.push(`${change.kind}:${change.scopeId}`);
  });
  chosen = "ls-two";
  // 사용자가 다른 그룹을 골라도 현재 임대는 다음 경계까지 유지된다
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-one", status: "active" });
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([
    { scopeId: "ls-one", reason: "revoked" },
  ]);
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "ls-one" },
    { scopeId: "ls-two" },
  ]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-two", leaseEpoch: 1 });
  expect(calls.at(-1)).toBe("ls-two");
  expect(changes).toContain("lease:ls-one");
  expect(changes).toContain("lease:ls-two");
});

test("a named group that is not a candidate does not revoke the holder", async () => {
  let chosen: RegistrationId | null = "ls-hold";
  const source: PrimitivesSettingsSource = {
    ...createStaticPrimitivesSettings(),
    activeDriver: () => chosen,
  };
  const t = await createTestHost({ settingsSource: source });
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-hold"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  chosen = "ls-missing";
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toEqual([]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ls-hold" });
});

test("a group released as idle is a candidate again only after a turn settles", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let invocations = 0;
  await t.host.install(
    makeGroupUnit({ name: "ls-idle" }, (g) => {
      g.drive(() => {
        invocations += 1;
        return Promise.resolve(yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 효과 없이 같은 판으로 두 번 반환하면 idle로 반납된다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.released")).toMatchObject([{ reason: "idle" }]);
  expect(t.host.leaseOf(thread)).toBeNull();
  const acquiredAfterIdle = kinds(t, thread, "lease.acquired").length;
  await t.boundary(thread).idle();
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(acquiredAfterIdle);
  // turn이 정착하면 다시 후보가 되고 다음 경계에서 부여된다
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(acquiredAfterIdle + 1);
  expect(invocations).toBeGreaterThanOrEqual(3);
});

function arbiterRecording(seen: (readonly DriveLockCandidate[])[]): PlatformModule {
  return {
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(DriveLockArbiterPortKey, {
        choose(_threadId, candidates) {
          seen.push(candidates);
          return null;
        },
      });
    },
  };
}

test("candidates carry the seq of the last scope.changed enabled, from the snapshot after a restart too", async () => {
  const t = await createTestHost();
  const seen: (readonly DriveLockCandidate[])[] = [];
  await t.host.registerPlatform(arbiterRecording(seen));
  await installDriveGroups(t, ["sq-a", "sq-b"], []);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  // 처음 켜지는 경계에서는 scope.changed가 아직 커밋 전이라 seq가 없다
  expect(seen[0]?.map((candidate) => candidate.enabledAtSeq)).toEqual([null, null]);
  const stored = (await snapshotOf(t.records, thread)).enabledAtSeq;
  expect(typeof stored["sq-a"]).toBe("number");
  expect(typeof stored["sq-b"]).toBe("number");
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen.at(-1)?.map((candidate) => candidate.enabledAtSeq)).toEqual([
    stored["sq-a"] ?? null,
    stored["sq-b"] ?? null,
  ]);

  // 재시작 뒤 첫 중재는 스냅샷의 seq를 쓴다
  const second = await createTestHost({
    shared: { records: t.records, loop: t.loop, queue: t.queue },
  });
  const afterRestart: (readonly DriveLockCandidate[])[] = [];
  await second.host.registerPlatform(arbiterRecording(afterRestart));
  await installDriveGroups(second, ["sq-a", "sq-b"], []);
  await second.host.openThread(thread);
  await second.settled();
  expect(afterRestart[0]?.map((candidate) => candidate.enabledAtSeq)).toEqual([
    stored["sq-a"] ?? null,
    stored["sq-b"] ?? null,
  ]);
});

test("a child conversation gets no drive lease and its drive function never runs", async () => {
  const t = await createTestHost();
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-child"], calls);
  const child = t.newThread();
  await t.host.openThread(child, { child: true });
  await t.settled();
  await t.boundary(child).turnSettled();
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.host.leaseOf(child)).toBeNull();
  expect(kinds(t, child, "lease.acquired")).toEqual([]);
  // 같은 호스트의 주 대화는 임대를 받는다
  const main = t.newThread();
  await t.host.openThread(main);
  await t.settled();
  expect(calls).toEqual(["ls-child"]);
  expect(kinds(t, main, "lease.acquired")).toMatchObject([{ scopeId: "ls-child" }]);
});

const OpenSchema = Type.Object({ open: Type.Boolean() }, { additionalProperties: false });

test("a drive that returns done gives the lock to the next group at once, and is no candidate until its state changes", async () => {
  // 앞 그룹을 활성으로 골라 두면 처음 부여는 앞 그룹이 받고, 그 그룹이 `done`으로 물러나면 뒤 그룹이 바로 받는다
  const source: PrimitivesSettingsSource = {
    ...createStaticPrimitivesSettings(),
    activeDriver: () => "ls-lazy",
  };
  const t = await createTestHost({ settingsSource: source });
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeGroupUnit(
      {
        name: "ls-lazy",
        loadIndex: 0,
        def: { state: { schema: OpenSchema, initial: { open: false }, version: 1 } },
      },
      (g) => {
        g.drive(({ state }) => Promise.resolve(state.open ? yieldOf() : doneOf()));
      },
    ),
  );
  await t.host.install(
    makeGroupUnit({ name: "ls-busy", loadIndex: 1 }, (g) => {
      g.drive(({ last }) => {
        if (last === null) calls.push("ls-busy");
        return Promise.resolve(last === null ? turnOf("busy") : yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
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
    makeGroupUnit(
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
  expect(calls).toEqual(["ls-open"]);
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([{ scopeId: "ls-open" }]);
});

test("drive limits are read from the options getter when a lease is taken, so a change applies to the next lease", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let maxTurns = 2;
  await t.host.install(
    makeGroupUnit({ name: "ls-limits" }, (g) => {
      g.drive(() => Promise.resolve(yieldOf()), {
        get limits() {
          return { maxTurns };
        },
      });
    }),
  );
  await t.host.openThread(thread);
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
  await t.boundary(thread).idle();
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "ls-limits", limits: { maxTurns: 2 } },
    { scopeId: "ls-limits", limits: { maxTurns: 5 } },
  ]);
});

test("a user interrupt releases the lease as revoked and the drive is not called again until the next command", async () => {
  const t = await createTestHost();
  const calls: string[] = [];
  await installDriveGroups(t, ["ls-stop"], calls);
  const thread = t.newThread();
  await t.host.openThread(thread);
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

  // 사용자의 다음 명령이 정착하면 다시 후보가 된다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(kinds(t, thread, "lease.acquired")).toHaveLength(2);
});
