import { expect, test } from "bun:test";
import type { GroupStatus } from "@fresnel/contracts/services";
import { createGroupService, defineGroup, type GroupModule } from "../src/index.ts";
import { groupCatalogOf } from "../src/testing/index.ts";
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
