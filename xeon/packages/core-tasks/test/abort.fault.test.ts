import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { FaultInjector, FaultPoint } from "@xeon/contracts/records";
import type { AbortReason } from "@xeon/contracts/services";
import { memoryTasks, memorySession, recordingLogger } from "../src/testing/index.ts";
import { fixedIdFactory } from "./support/ids.ts";
import { createWorld, openTurn, turnAbortIntent, type World } from "./support/world.ts";

const USER_STOP: AbortReason = { code: "user", message: "stop" };

function faultAt(point: FaultPoint): { armed: boolean; readonly injector: FaultInjector } {
  const state = {
    armed: true,
    injector: {
      hit: (hitPoint: FaultPoint): void => {
        if (state.armed && hitPoint === point) throw new Bug(`fault:${hitPoint}`);
      },
    },
  };
  return state;
}

/** 오류 주입을 켠 세션 위의 world. 세션을 먼저 만들고 서비스를 얹는다 */
function worldWithFaults(injector: FaultInjector): World {
  const ids = fixedIdFactory();
  const log = recordingLogger();
  const session = memorySession({ ids, faults: injector });
  const threadId = ids.next("thr");
  session.openThread(threadId);
  const { tasks } = memoryTasks({ ids, session, log: log.logger });
  return { tasks, session, log, threadId, ids };
}

test("abort_intent_recorded_before_signal", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn } = openTurn(world);
  // 신호가 켜지는 순간에 의도 이벤트가 이미 커밋되어 있어야 한다
  const seenAtSignal: string[] = [];
  turn.signal.addEventListener("abort", () => {
    seenAtSignal.push(...session.events.map((event) => event.kind));
  });
  await tasks.abort(turn, USER_STOP);
  expect(seenAtSignal).toEqual(["turn.abort_requested"]);
});

test("abort_intent_recorded_before_signal: a failed intent commit sends no signal", async () => {
  const fault = faultAt("before_commit");
  const world = worldWithFaults(fault.injector);
  const { turn } = openTurn(world);

  const failed = await world.tasks.abort(turn, USER_STOP).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(failed).toBeInstanceOf(Bug);
  expect(turn.signal.aborted).toBe(false);
  expect(world.session.events).toEqual([]);
  expect(turn.state).toBe("live");

  // 같은 노드에 다시 abort하면 의도부터 다시 쓴다
  fault.armed = false;
  const retried = await world.tasks.abort(turn, USER_STOP);
  expect(retried.ok && retried.value.status).toBe("signalled");
  expect(turn.signal.aborted).toBe(true);
  expect(world.session.events.map((event) => event.kind)).toEqual(["turn.abort_requested"]);
});

test("a persistent busy writer sends no signal and returns the store error", async () => {
  const world = createWorld();
  const { turn } = openTurn(world);
  world.session.failNext({ kind: "busy" }, 3);
  const result = await world.tasks.abort(turn, USER_STOP);
  expect(result).toEqual({ ok: false, error: { kind: "busy" } });
  expect(world.session.commitCalls).toBe(3);
  expect(turn.signal.aborted).toBe(false);
  expect(world.session.events).toEqual([]);
});

test("busy is retried with the same request and then succeeds", async () => {
  const world = createWorld();
  const { turn } = openTurn(world);
  world.session.failNext({ kind: "busy" }, 2);
  const result = await world.tasks.abort(turn, USER_STOP);
  expect(result.ok && result.value.status).toBe("signalled");
  expect(world.session.commitCalls).toBe(3);
  expect(world.session.events.length).toBe(1);
});

test("a lost ownership still stops the in-memory work and returns the error", async () => {
  const world = createWorld();
  const { turn } = openTurn(world);
  world.session.failNext({ kind: "ownership_lost", threadId: world.threadId });
  const result = await world.tasks.abort(turn, USER_STOP);
  expect(result).toEqual({
    ok: false,
    error: { kind: "ownership_lost", threadId: world.threadId },
  });
  expect(turn.signal.aborted).toBe(true);
  expect(world.session.events).toEqual([]);
});

test("a cascade intent lost to a crash does not block the signal", async () => {
  // 직접 의도(첫 커밋)는 통과하고 자식의 cascade 커밋(둘째)에서 끊긴다
  let commits = 0;
  const world = worldWithFaults({
    hit: (point) => {
      if (point !== "before_commit") return;
      commits += 1;
      if (commits === 2) throw new Bug("fault:cascade");
    },
  });
  const { tasks, session, log } = world;
  const { turn, turnId } = openTurn(world);
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const child = tasks.openScope(tool, { kind: "subagent", id: "thr_child" });
  const childTurnId = world.ids.next("trn");
  const childTurn = tasks.openScope(child, {
    kind: "turn",
    id: childTurnId,
    abortIntent: turnAbortIntent(world, childTurnId),
  });

  const result = await tasks.abort(turn, USER_STOP);
  expect(result.ok && result.value.status).toBe("signalled");
  expect(childTurn.signal.aborted).toBe(true);
  // 직접 의도만 남는다. 자식의 의도는 재개 때 소유 사슬에서 도출한다(spec §4.2 4번, §4.8 3번)
  expect(session.events.map((event) => event.kind)).toEqual(["turn.abort_requested"]);
  expect(session.events[0]?.turnId).toBe(turnId);
  expect(log.records.map((record) => record.event)).toEqual(["tasks.cascade_intent_threw"]);
});
