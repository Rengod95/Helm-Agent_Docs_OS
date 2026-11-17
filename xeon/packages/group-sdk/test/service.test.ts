import { expect, test } from "bun:test";
import type { GroupSettingUnwritableReason, GroupStatus } from "@fresnel/contracts/services";
import { createGroupService, defineGroup, type GroupModule } from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { serviceRig, startDriveOf } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";
import { turnFinished } from "./support/steps.ts";

function driver(name: string, options: { readonly throws?: boolean } = {}): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, drives: true }),
    setup(g) {
      g.drive(async ({ last }) => {
        if (options.throws === true) throw new TypeError(`${name} drive failed`);
        if (turnFinished(last)) return { do: "yield" };
        return { do: "turn", input: { kind: "user", content: name } };
      });
    },
  });
}

/** 첫 단계에서 `to`에게 맡기고, 맡긴 결과가 돌아오면 끝낸다 */
function handoffDriver(name: string, to: string): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, drives: true }),
    setup(g) {
      g.drive(async ({ last }) => {
        if (last === null) return { do: "handoff", to, input: { from: name } };
        return { do: "done" };
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
  expect(holder.read(null)).toBe("helm");
});

test("service.set-holder-reports-a-locked-setting-without-changing-it", async () => {
  const rigged = await serviceRig([driver("helm")]);
  const lockedHolder = memoryDriveHolderSettings({ locked: true, initial: "helm" });
  const locked = createGroupService({
    host: rigged.t.host,
    catalog: groupCatalogOf([driver("helm")]),
    holder: lockedHolder,
    currentThread: () => rigged.thread,
    report: () => {},
  });
  expect(await locked.setDriveHolder("auto")).toEqual({
    ok: false,
    error: { kind: "group.settingLocked", key: "x.primitives.activeDriver" },
  });
  expect(lockedHolder.read(null)).toBe("helm");
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
      error: { kind: "group.settingUnwritable", key: "x.primitives.activeDriver", reason },
    })),
  );
});

test("service.set-holder-passes-the-named-thread-to-the-write-and-measures-appliesAt-there", async () => {
  const { service, holder, thread, t } = await serviceRig([driver("helm")]);
  await startDriveOf(t, thread, "helm");
  const other = t.newThread();
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "helm" });
  expect(t.host.leaseOf(other)).toBeNull();
  // 상태를 보이는 thread에는 helm 프레임이 있어 바로 적용이고, 가리킨 thread에는 스택이 없어 다음 경계다
  const here = await service.setDriveHolder("helm", { scope: "launch" });
  const named = await service.setDriveHolder("helm", { scope: "launch", threadId: other });
  expect(here).toMatchObject({ ok: true, value: { appliesAt: "now" } });
  expect(named).toMatchObject({ ok: true, value: { appliesAt: "nextStepBoundary" } });
  expect(holder.writes).toEqual([
    { holder: "helm", scope: "launch", threadId: null },
    { holder: "helm", scope: "launch", threadId: other },
  ]);
});

test("service.set-holder-tells-when-the-change-applies", async () => {
  const { service, t, thread } = await serviceRig([
    driver("helm"),
    driver("review"),
    quiet("learning"),
  ]);
  await startDriveOf(t, thread, "helm");
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "helm" });
  // 스택 맨 위 그룹을 지정하면 바로 적용이다
  expect(await service.setDriveHolder("helm")).toMatchObject({ value: { appliesAt: "now" } });
  // 다른 켜진 drive 그룹을 지정하면 다음 경계에 적용한다(E3 이전 규칙을 그대로 옮긴 값이다)
  expect(await service.setDriveHolder("review")).toMatchObject({
    value: { appliesAt: "nextStepBoundary" },
  });
  // 꺼진 그룹을 지정하면 현재 스택을 유지하고 스택이 풀릴 때 적용된다
  service.disable("review");
  await t.boundary(thread).stepEnd();
  await t.settled();
  expect(await service.setDriveHolder("review")).toMatchObject({
    value: { appliesAt: "afterLeaseRelease" },
  });
  // auto는 스택을 건드리지 않으므로 바로 적용이다
  expect(await service.setDriveHolder("auto")).toMatchObject({
    value: { holder: null, appliesAt: "now" },
  });
});

test("service.list-orders-holder-then-enabled-then-disabled", async () => {
  const { service, t, thread } = await serviceRig([
    quiet("zeta"),
    driver("helm"),
    driver("review"),
    quiet("alpha"),
  ]);
  await startDriveOf(t, thread, "helm");
  expect(ids(service.list())).toEqual(["helm", "zeta", "review", "alpha"]);
  service.disable("zeta");
  service.disable("alpha");
  await t.settled();
  // 꺼진 그룹은 맨 뒤에 이름순이다
  expect(ids(service.list())).toEqual(["helm", "review", "alpha", "zeta"]);
});

test("service.drive-roles-come-from-the-frame-stack", async () => {
  const { service, t, thread } = await serviceRig([
    driver("crashy", { throws: true }),
    handoffDriver("helm", "review"),
    driver("review"),
    quiet("learning"),
  ]);
  // 시작 요청을 받은 crashy는 첫 단계에서 던져 오류 상태가 된다
  await startDriveOf(t, thread, "crashy");
  expect(service.status("crashy")).toMatchObject({
    ok: true,
    value: {
      drive: "error",
      lastError: { kind: "group.driveThrew", message: "crashy drive failed" },
    },
  });
  // helm은 review에게 맡기므로 helm은 스택 아래 프레임(waiting), review가 맨 위(holder)다
  await startDriveOf(t, thread, "helm");
  await t.boundary(thread).turnSettled();
  await t.settled();
  const byId = new Map(service.list().map((group) => [group.id, group]));
  expect(byId.get("review")).toMatchObject({ drive: "holder" });
  expect(byId.get("helm")).toMatchObject({ drive: "waiting" });
  expect(byId.get("learning")).toMatchObject({ drive: "none", usesDrive: false, lastError: null });
  expect(service.list().filter((group) => group.drive === "holder")).toHaveLength(1);
  expect(byId.get("review")?.leaseId).toBe(t.host.leaseOf(thread)?.leaseId ?? null);
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

test("service.enable-calls-onEnabled-so-the-failure-ledger-can-be-cleared", async () => {
  const enabled: string[] = [];
  const { service, t } = await serviceRig([driver("helm"), quiet("learning")], {
    onEnabled: (id) => enabled.push(id),
  });
  expect(service.disable("learning")).toMatchObject({ ok: true });
  await t.settled();
  expect(enabled).toEqual([]);
  expect(service.enable("learning")).toMatchObject({ ok: true });
  expect(service.enable("ghost")).toMatchObject({ ok: false });
  expect(enabled).toEqual(["learning"]);
});
