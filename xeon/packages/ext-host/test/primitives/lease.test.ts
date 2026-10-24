import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { LeaseArbiterPortKey, type LeaseCandidate, type ScopeId } from "@xeon/contracts/extensions";
import type { PlatformModule } from "../../src/primitives/index.ts";
import {
  createStaticPrimitivesSettings,
  type PrimitivesSettingsSource,
} from "../../src/primitives/settings.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeGroupUnit, snapshotOf } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

function installDriveGroups(t: Host, names: readonly string[], calls: string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeGroupUnit({ name, loadIndex }, (g) => {
        g.drive(async (loop) => {
          calls.push(name);
          await loop.turn({ input: { kind: "user", content: name } });
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
  const seen: (readonly LeaseCandidate[])[] = [];
  await t.host.registerPlatform({
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, {
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
      ctx.providePort(LeaseArbiterPortKey, { choose: (): ScopeId | null => null });
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
  let chosen: ScopeId | null = "ls-one";
  const base = createStaticPrimitivesSettings();
  const source: PrimitivesSettingsSource = {
    ...base,
    activeDriveGroup: () => chosen,
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
  let chosen: ScopeId | null = "ls-hold";
  const source: PrimitivesSettingsSource = {
    ...createStaticPrimitivesSettings(),
    activeDriveGroup: () => chosen,
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
        return Promise.resolve();
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

function arbiterRecording(seen: (readonly LeaseCandidate[])[]): PlatformModule {
  return {
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, {
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
  const seen: (readonly LeaseCandidate[])[] = [];
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
  const afterRestart: (readonly LeaseCandidate[])[] = [];
  await second.host.registerPlatform(arbiterRecording(afterRestart));
  await installDriveGroups(second, ["sq-a", "sq-b"], []);
  await second.host.openThread(thread);
  await second.settled();
  expect(afterRestart[0]?.map((candidate) => candidate.enabledAtSeq)).toEqual([
    stored["sq-a"] ?? null,
    stored["sq-b"] ?? null,
  ]);
});
