import { expect, test } from "bun:test";
import type { OrchestrationStatus } from "@fresnel/contracts/services";
import {
  createOrchestrationService,
  defineOrchestration,
  type OrchestrationModule,
} from "../src/index.ts";
import { orchestrationCatalogOf } from "../src/testing/index.ts";
import { serviceRig, startDriveOf } from "./support/host.ts";
import { orchestrationManifestOf } from "./support/manifests.ts";
import { turnFinished } from "./support/steps.ts";

function driver(name: string, options: { readonly throws?: boolean } = {}): OrchestrationModule {
  return defineOrchestration({
    manifest: orchestrationManifestOf({ name, drives: true }),
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
function handoffDriver(name: string, to: string): OrchestrationModule {
  return defineOrchestration({
    manifest: orchestrationManifestOf({ name, drives: true }),
    setup(g) {
      g.drive(async ({ last }) => {
        if (last === null) return { do: "handoff", to, input: { from: name } };
        return { do: "done" };
      });
    },
  });
}

function quiet(name: string): OrchestrationModule {
  return defineOrchestration({ manifest: orchestrationManifestOf({ name }), setup() {} });
}

function ids(groups: readonly OrchestrationStatus[]): string[] {
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
  t.host.registration("zeta")?.disable();
  t.host.registration("alpha")?.disable();
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
  expect(service.list().find((group) => group.id === "crashy")).toMatchObject({
    drive: "error",
    lastError: { kind: "orchestration.driveThrew", message: "crashy drive failed" },
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

test("service.metrics-follow-the-instrumentation-setting", async () => {
  const { t, thread } = await serviceRig([driver("helm")]);
  let enabled = true;
  const service = createOrchestrationService({
    host: t.host,
    catalog: orchestrationCatalogOf([driver("helm")]),
    currentThread: () => thread,
    instrumentation: () => enabled,
    metrics: () => ({ denies: 1, posts: 2, spawns: 3, delegates: 4, costUsd: 0, leaseMs: 0 }),
  });
  expect(service.list().find((group) => group.id === "helm")?.metrics).toEqual({
    denies: 1,
    posts: 2,
    spawns: 3,
    delegates: 4,
    costUsd: 0,
    leaseMs: 0,
  });
  enabled = false;
  expect(service.list().find((group) => group.id === "helm")?.metrics).toBeNull();
});
