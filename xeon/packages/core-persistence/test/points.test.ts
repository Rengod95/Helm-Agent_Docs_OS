import { describe, expect, test } from "bun:test";
import { completeTurn, itemAt } from "./support/branching.ts";
import { expectOk, newThread, openHarness, reopenHarness } from "./support/harness.ts";
import { recordingPoints } from "./support/points.ts";

describe("session points", () => {
  // spec plan session_points_fire_at_spec_times
  test("session_points_fire_at_spec_times: start, info_changed, before_switch, before_fork, before_tree, tree, shutdown", async () => {
    const recording = recordingPoints();
    const h = await openHarness({ points: recording.points });
    const { threadId } = newThread(h, "t");
    const names = (): string[] => recording.calls.map((call) => call.point);
    // create가 session.start{new}, 열기가 session.start{startup}
    await Promise.resolve();
    expect(recording.calls.map((call) => [call.point, call.payload])).toEqual([
      ["session.start", { reason: "new", threadId }],
      ["session.start", { reason: "startup", threadId }],
    ]);
    completeTurn(h, threadId);
    completeTurn(h, threadId);
    expectOk(h.service.threads.setTitle(threadId, "named", "k1"));
    expectOk(await h.service.threads.prepareSwitch(threadId, null));
    const newId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, itemAt(h, threadId, 1).itemId, newId));
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1"));
    await h.service.release(threadId, "quit");
    await Promise.resolve();
    expect(names()).toEqual([
      "session.start",
      "session.start",
      "session.info.after",
      "session.switch.before",
      "session.fork.before",
      "session.start",
      "session.tree.before",
      "session.tree.after",
      "session.shutdown",
    ]);
    expect(recording.calls.at(-1)?.payload).toEqual({ reason: "quit" });
  });

  test("opening a thread with a recovery marker says resume", async () => {
    const first = recordingPoints();
    const h = await openHarness({ points: first.points });
    const { threadId } = newThread(h);
    const info = h.store.leases.inspect(`session:${threadId}`);
    if (!info.ok || info.value === null) throw new Error("no lease");
    const { startTurn } = await import("./support/harness.ts");
    startTurn(h, threadId);
    const second = recordingPoints();
    const restarted = await reopenHarness(h, { points: second.points });
    expectOk(
      restarted.service.openForWrite(threadId, {
        resource: `session:${threadId}`,
        holderId: info.value.holderId,
        epoch: info.value.epoch,
      }),
    );
    await Promise.resolve();
    expect(second.calls.map((call) => call.payload)).toEqual([{ reason: "resume", threadId }]);
  });

  test("a read-only open fires nothing", async () => {
    const recording = recordingPoints();
    const h = await openHarness({ points: recording.points });
    const { threadId } = newThread(h);
    recording.calls.length = 0;
    const observer = await reopenHarness(h, { points: recording.points });
    expectOk(observer.service.openForRead(threadId));
    await Promise.resolve();
    expect(recording.calls).toEqual([]);
  });
});
