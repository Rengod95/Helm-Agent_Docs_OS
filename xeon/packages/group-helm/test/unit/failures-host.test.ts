import { expect, test } from "bun:test";
import { LeaseArbiterPortKey } from "@xeon/contracts/extensions";
import { withDriveDefaults } from "@xeon/ext-host";
import { createTestHost, fakeUsage } from "@xeon/ext-host/testing";
import { createGroupService } from "@xeon/group-kit";
import { groupCatalogOf, memoryDriveHolderSettings } from "@xeon/group-kit/testing";
import { helmGroup } from "../../src/index.ts";
import { callCommand, drainRounds, settleOnce } from "../support/rig.ts";

test("failures.unknown-error-rethrown: an unexpected exception leaves the drive and marks the group driveThrew", async () => {
  const holder = memoryDriveHolderSettings();
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => holder.read(null),
      capabilityProviders: () => ({}),
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
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([helmGroup]),
    holder,
    currentThread: () => thread,
    report: () => {},
  });
  await t.host.registerPlatform({
    name: "xeon-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, service);
    },
  });
  await t.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 0,
    builtin: true,
  });
  await t.host.openThread(thread);
  await t.settled();
  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "start");
  await drainRounds(t, thread, 6);
  const status = service.status("helm");
  expect(status.ok && status.value.drive).toBe("error");
  expect(status.ok && status.value.lastError?.kind).toBe("group.driveThrew");
  // 모르는 예외는 삼키지 않는다: 탐구는 끝난 기록 없이 마지막 커밋 상태에 남는다
  expect(t.records.events(thread).some((event) => event.kind === "grp.helm.inquiry.finished")).toBe(
    false,
  );
});
