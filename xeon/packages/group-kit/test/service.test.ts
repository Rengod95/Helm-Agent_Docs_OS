import { expect, test } from "bun:test";
import type { GroupSettingUnwritableReason, GroupStatus } from "@xeon/contracts/services";
import { createGroupService, defineGroup, type GroupModule } from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { serviceRig } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

function driver(name: string, options: { readonly throws?: boolean } = {}): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, usesDrive: true }),
    setup(g) {
      g.drive(async (loop) => {
        if (options.throws === true) throw new TypeError(`${name} drive failed`);
        await loop.turn({ input: { kind: "user", content: name } });
      });
    },
  });
}

function quiet(name: string): GroupModule {
  return defineGroup({ manifest: groupManifestOf({ name }), setup() {} });
}

function ids(groups: readonly GroupStatus[]): string[] {
  return groups.map((group) => group.id);
}

test("service.set-holder-rejects-unknown-and-no-drive", async () => {
  const { service, holder } = await serviceRig([driver("helm"), quiet("learning")]);
  expect(await service.setDriveHolder("xyz")).toEqual({
    ok: false,
    error: { kind: "group.unknown", id: "xyz", known: ["helm", "learning"] },
  });
  expect(await service.setDriveHolder("learning")).toEqual({
    ok: false,
    error: { kind: "group.noDrive", id: "learning" },
  });
  expect(holder.writes).toEqual([]);
  expect(holder.read(null)).toBeNull();

  const accepted = await service.setDriveHolder("helm", { scope: "user" });
  expect(accepted).toMatchObject({ ok: true, value: { holder: "helm", scope: "user" } });
  expect(holder.writes).toEqual([{ holder: "helm", scope: "user", threadId: null }]);
  expect(service.driveHolderSetting()).toBe("helm");
});

test("service.set-holder-reports-a-locked-setting-without-changing-it", async () => {
  const rigged = await serviceRig([driver("helm")]);
  const locked = createGroupService({
    host: rigged.t.host,
    catalog: groupCatalogOf([driver("helm")]),
    holder: memoryDriveHolderSettings({ locked: true, initial: "helm" }),
    currentThread: () => rigged.thread,
    report: () => {},
  });
  expect(await locked.setDriveHolder("auto")).toEqual({
    ok: false,
    error: { kind: "group.settingLocked", key: "x.primitives.activeDriveGroup" },
  });
  expect(locked.driveHolderSetting()).toBe("helm");
});

test("service.set-holder-reports-each-unwritable-reason-apart-from-a-lock", async () => {
  const reasons: readonly GroupSettingUnwritableReason[] = [
    "no_thread",
    "ambiguous_thread",
    "not_owner",
    "project_unavailable",
    "invalid_value",
    "storage",
  ];
  const rigged = await serviceRig([driver("helm")]);
  const results = await Promise.all(
    reasons.map((reason) => {
      const holder = memoryDriveHolderSettings({ unwritable: reason, initial: "helm" });
      const service = createGroupService({
        host: rigged.t.host,
        catalog: groupCatalogOf([driver("helm")]),
        holder,
        currentThread: () => rigged.thread,
        report: () => {},
      });
      return service.setDriveHolder("auto");
    }),
  );
  expect(results).toEqual(
    reasons.map((reason) => ({
      ok: false,
      error: { kind: "group.settingUnwritable", key: "x.primitives.activeDriveGroup", reason },
    })),
  );
});

test("service.set-holder-passes-the-named-thread-to-the-write-and-measures-appliesAt-there", async () => {
  const { service, holder, thread, t } = await serviceRig([driver("helm")]);
  const other = t.newThread();
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "helm" });
  expect(t.host.leaseOf(other)).toBeNull();
  // 상태를 보이는 thread에는 helm 임대가 있어 바로 적용이고, 가리킨 thread에는 임대가 없어 다음 경계다
  const here = await service.setDriveHolder("helm", { scope: "session" });
  const named = await service.setDriveHolder("helm", { scope: "session", threadId: other });
  expect(here).toMatchObject({ ok: true, value: { appliesAt: "now" } });
  expect(named).toMatchObject({ ok: true, value: { appliesAt: "nextStepBoundary" } });
  expect(holder.writes).toEqual([
    { holder: "helm", scope: "session", threadId: null },
    { holder: "helm", scope: "session", threadId: other },
  ]);
});

test("service.set-holder-tells-when-the-change-applies", async () => {
  const { service, t, thread } = await serviceRig([
    driver("helm"),
    driver("review"),
    quiet("learning"),
  ]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "helm" });
  // 임대를 가진 그룹을 지정하면 바로 적용이다
  expect(await service.setDriveHolder("helm")).toMatchObject({ value: { appliesAt: "now" } });
  // 다른 후보를 지정하면 X가 다음 경계에 임대를 옮긴다
  expect(await service.setDriveHolder("review")).toMatchObject({
    value: { appliesAt: "nextStepBoundary" },
  });
  // 후보가 아닌 그룹(꺼진 그룹)을 지정하면 현재 임대를 유지하고 임대가 풀릴 때 적용된다
  service.disable("review");
  await t.boundary(thread).stepEnd();
  await t.settled();
  expect(await service.setDriveHolder("review")).toMatchObject({
    value: { appliesAt: "afterLeaseRelease" },
  });
  // auto는 현재 holder를 유지하므로 바로 적용이다
  expect(await service.setDriveHolder("auto")).toMatchObject({
    value: { holder: null, appliesAt: "now" },
  });
});

test("service.list-orders-holder-then-enabled-then-disabled", async () => {
  const { service, t } = await serviceRig([
    quiet("zeta"),
    driver("helm"),
    driver("review"),
    quiet("alpha"),
  ]);
  expect(ids(service.list())).toEqual(["helm", "zeta", "review", "alpha"]);
  service.disable("zeta");
  service.disable("alpha");
  await t.settled();
  // 꺼진 그룹은 맨 뒤에 이름순이다
  expect(ids(service.list())).toEqual(["helm", "review", "alpha", "zeta"]);
});

test("service.drive-roles-lease-id-and-errors", async () => {
  const { service, t, thread } = await serviceRig([
    driver("crashy", { throws: true }),
    driver("helm"),
    driver("review"),
    quiet("learning"),
  ]);
  const byId = new Map(service.list().map((group) => [group.id, group]));
  const lease = t.host.leaseOf(thread);
  expect(lease).not.toBeNull();
  // 먼저 켜진 crashy가 임대를 받자마자 drive가 던져 반납했고, 그다음 후보 helm이 임대를 갖는다
  expect(byId.get("crashy")).toMatchObject({
    drive: "error",
    lastError: { kind: "group.driveThrew" },
  });
  expect(byId.get("crashy")?.lastError?.message).toContain("crashy drive failed");
  expect(byId.get("learning")).toMatchObject({ drive: "none", usesDrive: false, lastError: null });
  const holders = service.list().filter((group) => group.drive === "holder");
  expect(holders).toHaveLength(1);
  expect(holders[0]?.leaseId).toBe(lease?.leaseId ?? null);
  const waiting = service.list().filter((group) => group.drive === "waiting");
  expect(waiting.every((group) => group.leaseId === null)).toBe(true);
  expect(byId.get("helm")?.recordKinds).toEqual([]);
});

test("service.status-reports-pending-toggle", async () => {
  const { service, t, thread } = await serviceRig([driver("helm"), quiet("learning")]);
  t.loop.setRunning(thread, true);
  const receipt = service.disable("learning");
  expect(receipt).toEqual({
    ok: true,
    value: { id: "learning", status: "disabling", appliesAt: "nextStepBoundary" },
  });
  expect(service.status("learning")).toMatchObject({
    ok: true,
    value: { scope: "disabling", pendingToggle: "disable" },
  });
  await t.boundary(thread).stepEnd();
  t.loop.setRunning(thread, false);
  await t.settled();
  expect(service.status("learning")).toMatchObject({
    ok: true,
    value: { scope: "disabled", pendingToggle: null },
  });
  // 유휴 시점의 켜기는 곧바로 적용된다고 알린다
  expect(service.enable("learning")).toMatchObject({ ok: true, value: { appliesAt: "now" } });
  await t.settled();
  expect(service.status("learning")).toMatchObject({ ok: true, value: { scope: "enabled" } });
  expect(service.enable("ghost")).toMatchObject({
    ok: false,
    error: { kind: "group.unknown", id: "ghost" },
  });
  expect(service.disable("ghost")).toMatchObject({ ok: false });
  expect(service.status("ghost")).toMatchObject({ ok: false });
});

test("service.on-change-notifies-once-per-tick-and-stops-after-unsubscribe", async () => {
  const { service, t, thread, reported } = await serviceRig([driver("helm"), quiet("learning")]);
  const seen: (readonly GroupStatus[])[] = [];
  const stop = service.onChange((groups) => {
    seen.push(groups);
  });
  const crashing = service.onChange(() => {
    throw new TypeError("listener failed");
  });
  t.loop.setRunning(thread, true);
  service.disable("learning");
  service.disable("helm");
  await t.settled();
  // 같은 동기 구간의 변경 두 개는 알림 한 번이다
  expect(seen).toHaveLength(1);
  expect(seen[0]?.map((group) => group.pendingToggle)).toEqual(["disable", "disable"]);
  // 구독자가 던져도 다른 구독자에게 전달하고 report로 남긴다
  expect(reported).toHaveLength(1);
  crashing();
  await t.boundary(thread).stepEnd();
  t.loop.setRunning(thread, false);
  await t.settled();
  expect(seen.length).toBeGreaterThanOrEqual(2);
  const count = seen.length;
  stop();
  service.enable("helm");
  await t.settled();
  expect(seen).toHaveLength(count);
});

test("service.metrics-follow-the-instrumentation-setting", async () => {
  const { t, thread } = await serviceRig([driver("helm")]);
  let enabled = true;
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([driver("helm")]),
    holder: memoryDriveHolderSettings(),
    currentThread: () => thread,
    report: () => {},
    instrumentation: () => enabled,
    metrics: () => ({ denies: 1, posts: 2, spawns: 3, delegates: 4, costUsd: 0, leaseMs: 0 }),
  });
  expect(service.status("helm")).toMatchObject({ value: { metrics: { denies: 1, posts: 2 } } });
  enabled = false;
  expect(service.status("helm")).toMatchObject({ value: { metrics: null } });
});

test("service.choose-is-the-lease-arbiter-port", async () => {
  const { service, holder, t } = await serviceRig([driver("a-one"), driver("b-two")]);
  const thread = t.newThread();
  const candidates = [
    { scopeId: "b-two", extension: "b-two", loadIndex: 1, defaultEnabled: true, enabledAtSeq: 4 },
    { scopeId: "a-one", extension: "a-one", loadIndex: 0, defaultEnabled: true, enabledAtSeq: 9 },
  ];
  expect(service.choose(thread, candidates)).toBe("b-two");
  holder.set("a-one");
  expect(service.choose(thread, candidates)).toBe("a-one");
  holder.set("elsewhere");
  expect(service.choose(thread, candidates)).toBeNull();
});
