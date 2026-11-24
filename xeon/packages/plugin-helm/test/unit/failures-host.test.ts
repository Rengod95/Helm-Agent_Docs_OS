import { expect, test } from "bun:test";
import { withDriveDefaults } from "@fresnel/ext-host";
import { createTestHost, fakeUsage } from "@fresnel/ext-host/testing";
import { createOrchestrationService } from "@fresnel/orchestration-sdk";
import { orchestrationCatalogOf } from "@fresnel/orchestration-sdk/testing";
import { helmOrchestration } from "../../src/index.ts";
import { callCommand, drainRounds, settleOnce } from "../support/rig.ts";

test("failures.unknown-error-rethrown: an unexpected exception leaves the drive without marking the group broken", async () => {
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
  // 고장 표시는 그 대화의 그 실행에만 걸린다. 그룹 자체는 고장으로 표시하지 않는다(scnEng8 W-09)
  expect(status?.drive).not.toBe("error");
  expect(status?.lastError).toBeNull();
  // 모르는 예외는 삼키지 않는다: 탐구는 끝난 기록 없이 마지막 커밋 상태에 남는다
  expect(t.records.events(thread).some((event) => event.kind === "grp.helm.inquiry.finished")).toBe(
    false,
  );
});
