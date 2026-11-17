import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveCommand, RegistrationSetup } from "@fresnel/contracts/extensions";
import { createStaticPrimitivesSettings } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit, makeManifest, makeUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

/** 상태가 없는 그룹의 명령(S가 never) */
type Command = DriveCommand<never>;

/** drive를 등록하는 setup. 첫 단계(`last`가 null)에서 `name`을 기록하고 turn을 하나 낸다. turn 결과를 받은 단계는 끝낸다 */
function drivingSetup(calls: string[], name: string): RegistrationSetup<never> {
  return (g) => {
    g.drive(({ last }) => {
      if (last === null) calls.push(name);
      const command: Command =
        last === null ? { do: "turn", input: { kind: "user", content: name } } : { do: "yield" };
      return Promise.resolve(command);
    });
  };
}

function eventKinds(t: Host, thread: ThreadId): string[] {
  return t.records.events(thread).map((event) => event.kind);
}

function leaseAcquiredOf(t: Host, thread: ThreadId): unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === "lease.acquired")
    .map((event) => event.payload);
}

test("default policy: a plain extension whose plugin declares drives registers no drive and never holds the lock", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  const outcome = await t.host.install(
    makeUnit({ name: "drv-plain", drives: true }, drivingSetup(calls, "drv-plain")),
  );
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status, setup.failure?.code])).toEqual(
    [["drv-plain", "failed", "drive_requires_group"]],
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(leaseAcquiredOf(t, thread)).toEqual([]);
  expect(t.host.registrations()).toMatchObject([
    {
      id: "drv-plain",
      status: "disabled",
      drive: "none",
      lastError: { code: "drive_requires_group" },
    },
  ]);
});

test("an open policy lets the same plain extension register drive and take the lock", async () => {
  const t = await createTestHost({
    settingsSource: createStaticPrimitivesSettings({ driveRequiresGroup: false }),
  });
  const thread = t.newThread();
  const calls: string[] = [];
  const outcome = await t.host.install(
    makeUnit({ name: "drv-open", drives: true }, drivingSetup(calls, "drv-open")),
  );
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["drv-open", "applied"],
  ]);
  await t.host.openThread(thread, { startDrive: "drv-open" });
  await t.settled();
  expect(calls).toEqual(["drv-open"]);
  // 턴 결과가 주도 명령 정착 사건으로 남는다(drive.command_settled)
  expect(eventKinds(t, thread)).toEqual([
    "scope.changed",
    "lease.acquired",
    "drive.command_settled",
  ]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "drv-open", status: "active" });
  expect(t.host.registrations()).toMatchObject([
    { id: "drv-open", status: "enabled", drive: "holding" },
  ]);
});

test("default policy: a plugin group member with drives takes the lock", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  const outcome = await t.host.install(
    makeGroupUnit({ name: "drv-group" }, drivingSetup(calls, "drv-group")),
  );
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["drv-group", "applied"],
  ]);
  await t.host.openThread(thread, { startDrive: "drv-group" });
  await t.settled();
  expect(calls).toEqual(["drv-group"]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "drv-group" });
  expect(t.host.registrations()).toMatchObject([{ id: "drv-group", drive: "holding" }]);
});

test("default policy: a named plugin that group.members lists may drive", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "drv-listed",
      group: { members: ["main"] },
      extraPlugins: [{ id: "main", layer: "L3", hooks: [], drives: true, defaultEnabled: true }],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("drv-listed/main", {}, drivingSetup(calls, "drv-listed/main"));
    },
  });
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["drv-listed/main", "applied"],
  ]);
  await t.host.openThread(thread, { startDrive: "drv-listed/main" });
  await t.settled();
  expect(calls).toEqual(["drv-listed/main"]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "drv-listed/main" });
});

test("default policy: a named plugin that group.members does not list cannot drive, even when enabled", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "drv-part",
      group: { members: ["main"] },
      extraPlugins: [
        { id: "main", layer: "L3", hooks: [] },
        { id: "helper", layer: "L3", hooks: [], drives: true, defaultEnabled: true },
      ],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("drv-part/helper", {}, drivingSetup(calls, "drv-part/helper"));
    },
  });
  expect(outcome.unregistered).toEqual(["drv-part", "drv-part/main"]);
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status, setup.failure?.code])).toEqual(
    [["drv-part/helper", "failed", "drive_requires_group"]],
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.host.leaseOf(thread)).toBeNull();
});

test("an open policy still refuses drive from a plugin whose drives is not true", async () => {
  const t = await createTestHost({
    settingsSource: createStaticPrimitivesSettings({ driveRequiresGroup: false }),
  });
  const calls: string[] = [];
  const outcome = await t.host.install(
    makeUnit({ name: "drv-undecl" }, drivingSetup(calls, "drv-undecl")),
  );
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status, setup.failure?.code])).toEqual(
    [["drv-undecl", "failed", "drive_undeclared"]],
  );
  expect(calls).toEqual([]);
});

test("with the policy open, two enabled drive registrations: only the one a start request names holds the lock", async () => {
  const t = await createTestHost({
    settingsSource: createStaticPrimitivesSettings({ driveRequiresGroup: false }),
  });
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "drv-a", drives: true, loadIndex: 0 }, drivingSetup(calls, "drv-a")),
  );
  await t.host.install(
    makeUnit({ name: "drv-b", drives: true, loadIndex: 1 }, drivingSetup(calls, "drv-b")),
  );
  await t.host.openThread(thread, { startDrive: "drv-b" });
  await t.settled();
  expect(calls).toEqual(["drv-b"]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "drv-b", status: "active" });
  expect(leaseAcquiredOf(t, thread)).toMatchObject([{ scopeId: "drv-b" }]);
  expect(t.host.registrations().map((info) => [info.id, info.drive])).toEqual([
    ["drv-a", "registered"],
    ["drv-b", "holding"],
  ]);
});
