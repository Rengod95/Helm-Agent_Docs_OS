import { expect, test } from "bun:test";
import { driveStandIn } from "./support/drive-group.ts";
import { createRig } from "./support/rig.ts";

test("coexist.helm-lease-held-fork-still-runs: the review starts while another group holds the drive lease and the learning group never drives", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 1 } });
  const drive = driveStandIn("fake-drive");
  await rig.t.host.install(drive.unit);
  await rig.t.host.openThread(rig.thread);
  // 임대를 쥔 drive 함수가 끝나지 않으므로 host.settled()는 기다리지 않는다
  await Bun.sleep(20);
  rig.control.waitSettled = false;
  expect(drive.started()).toBeGreaterThan(0);
  expect(rig.t.host.leaseOf(rig.thread)?.scopeId).toBe("fake-drive");
  const turnsBefore = rig.t.loop.turns.length;
  await rig.turn();
  // 임계를 넘은 turn에서 검토가 시작되고, 임대는 그대로 Helm 대역이 쥔다
  expect(rig.agents.delegated).toHaveLength(1);
  expect(rig.agents.delegated[0]?.origin.owner).toEqual({ kind: "scope", scopeId: "learning" });
  expect(rig.t.host.leaseOf(rig.thread)?.scopeId).toBe("fake-drive");
  // 학습 그룹은 drive를 부르지 않는다: 루프 turn은 늘지 않았고 임대 후보가 아니다
  expect(rig.t.loop.turns.length).toBe(turnsBefore);
  expect(rig.module.manifest.usesDrive).toBe(false);
  drive.release();
  rig.control.waitSettled = true;
  await rig.t.settled();
});

test("coexist.drive-turns-do-not-count: a turn opened by the drive does not count as a user turn", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 1 } });
  await rig.turn({ origin: "drive" });
  await rig.turn({ origin: "drive", toolSteps: 3 });
  expect(rig.agents.delegated).toHaveLength(0);
  expect(rig.state()).toMatchObject({ userTurnsSinceReview: 0, toolIterationsSinceSkillWrite: 3 });
});
