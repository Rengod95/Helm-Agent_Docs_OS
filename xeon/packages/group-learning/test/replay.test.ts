import { expect, test } from "bun:test";
import { NO_EFFECTS, replayDrive } from "@xeon/group-kit/testing";
import { createLearningGroup } from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { TestHost } from "@xeon/ext-host/testing";
import {
  createLearningReplayHarness,
  scriptIds,
  type ReplayScript,
} from "./support/replay-harness.ts";

const SETTINGS = { "l3.learning.trigger.userTurns": 2 };

/** 두 번째 turn의 정착에서 검토가 시작되고, 자식이 정착한 뒤 세 번째 turn이 이어진다 */
const SCRIPT: ReplayScript = [
  async (t, thread) => {
    await settle(t, thread, 0);
  },
  async (t, thread) => {
    await settle(t, thread, 1);
  },
  async (t, thread, agents) => {
    const settled = agents.settle(thread, "learning:review:1", "completed");
    if (settled === undefined) return;
    await t.host.dispatch("lifecycle.agent.settled", settled, {
      threadId: thread,
      dispatchKey: "replay:agent-settled",
      ...(settled.owner?.kind === "scope" ? { onlyScope: settled.owner.scopeId } : {}),
    });
  },
  async (t, thread) => {
    await settle(t, thread, 2);
  },
];

async function settle(t: TestHost, thread: ThreadId, n: number): Promise<void> {
  const ids = await scriptIds();
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: ids.turn(n), aborted: false, lastItemId: ids.item(n) },
    { threadId: thread, dispatchKey: `replay:settle:${String(n)}` },
  );
}

test("replay.agent-settled-twice-one-delegate: cutting at every commit and firing the handlers again leaves one delegation, one record set and one state change", async () => {
  const harness = createLearningReplayHarness(SETTINGS, SCRIPT);
  const group = createLearningGroup({ clock: manualClock(), reader: harness.reader });
  const report = await replayDrive({
    group,
    harness,
    expectEffects: { delegate: 1, turn: 0, spawn: 0, post: 0 },
  });
  expect(report.failure).toBeUndefined();
  expect(report.ok).toBe(true);
  // 커밋 지점: 첫 turn의 카운터, 검토 시작, 검토 종료, 마지막 turn의 카운터
  expect(report.commits).toBeGreaterThanOrEqual(3);
  expect(report.cuts.map((cut) => cut.commitIndex)).toEqual(
    Array.from({ length: report.commits }, (_, index) => index + 1),
  );
  expect(report.cuts.every((cut) => cut.equal && cut.firstDiff === null)).toBe(true);
  // 기준 실행은 위임 1회. 어느 지점에서 끊어도 다시 실행이 새 효과를 내지 않는다
  expect(report.effects).toEqual({ turn: 0, spawn: 0, delegate: 1, post: 0 });
  expect(report.cuts.map((cut) => cut.effects)).toEqual(report.cuts.map(() => NO_EFFECTS));
  expect(harness.knowledge()?.calls()).toBe(0);
});
