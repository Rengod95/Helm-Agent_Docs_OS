import { expect, test } from "bun:test";
import { withDriveDefaults } from "@fresnel/ext-host";
import { createTestHost, fakeUsage } from "@fresnel/ext-host/testing";
import { createOrchestrationService } from "@fresnel/group-sdk";
import { orchestrationCatalogOf } from "@fresnel/group-sdk/testing";
import { helmOrchestration } from "../../src/index.ts";
import { callCommand, drainRounds, settleOnce } from "../support/rig.ts";

test("failures.unknown-error-rethrown: an unexpected exception leaves the drive and marks the group driveThrew", async () => {
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      driveMaxDepth: () => 8,
      capabilityProviders: () => ({}),
      driveRequiresOrchestration: () => true,
    },
    loop: {
      runTurn: () => {
        throw new TypeError("unexpected");
      },
      runSpawn: () =>
        Promise.resolve({
          outcome: { childThreadId: t.ids.next("thr"), status: "completed" },
          usage: fakeUsage(1),
        }),
    },
  });
  const thread = t.newThread();
  const service = createOrchestrationService({
    host: t.host,
    catalog: orchestrationCatalogOf([helmOrchestration]),
    currentThread: () => thread,
  });
  await t.host.install({
    manifest: helmOrchestration.manifest,
    entry: helmOrchestration.entry,
    loadIndex: 0,
    builtin: true,
  });
  await t.host.openThread(thread);
  await t.settled();
  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "start");
  await drainRounds(t, thread, 6);
  const status = service.list().find((group) => group.id === "helm");
  expect(status?.drive).toBe("error");
  expect(status?.lastError?.kind).toBe("orchestration.driveThrew");
  // 모르는 예외는 삼키지 않는다: 탐구는 끝난 기록 없이 마지막 커밋 상태에 남는다
  expect(t.records.events(thread).some((event) => event.kind === "grp.helm.inquiry.finished")).toBe(
    false,
  );
});
