import { expect, test } from "bun:test";
import type { Logger, Scheduler } from "@fresnel/contracts";
import type { DeltaRow, HookRun } from "@fresnel/contracts/wire";
import {
  createTurnRecordEvents,
  type TurnRecordEvent,
} from "../../src/assembly/measure/turn-events.ts";
import type { TurnWatch } from "../../src/connection-types.ts";
import {
  startTurnWatchFanout,
  TURN_DELTA_COALESCE_MS,
  TURN_DELTA_MAX_ROWS,
  type DeltaConnection,
} from "../../src/handlers/m5/watch.ts";

// 턴 기록 구독의 알림 쪽(정본 §3.5). 실제 사건 버스를 쓰고, 시계와 연결은 작은 대역으로 둔다.

function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

/** 손으로 돌리는 시계: `fireAll`이 걸린 시간 초과를 모두 부른다 */
function manualScheduler(): {
  readonly scheduler: Scheduler;
  readonly fireAll: () => void;
  readonly waiting: () => number;
} {
  let next = 1;
  const timers = new Map<number, () => void>();
  return {
    scheduler: {
      setTimeout: (fn) => {
        const handle = next;
        next += 1;
        timers.set(handle, fn);
        return handle;
      },
      clearTimeout: (handle) => {
        timers.delete(handle);
      },
    },
    fireAll: () => {
      for (const [handle, fn] of Array.from(timers)) {
        timers.delete(handle);
        fn();
      }
    },
    waiting: () => timers.size,
  };
}

interface TestConnection extends DeltaConnection {
  readonly sent: unknown[];
}

function connection(phase: DeltaConnection["phase"] = "ready"): TestConnection {
  const sent: unknown[] = [];
  return {
    phase,
    turnWatches: new Map(),
    sender: {
      push: (message) => {
        sent.push(message);
      },
    },
    sent,
  };
}

function hookRun(seq: number): HookRun {
  return {
    hook: "tool.call.before",
    registrationId: "reg-guard",
    plugin: "guard",
    versionId: null,
    sourceKind: "plugin",
    seq,
    subject: {},
    toolCallId: null,
    result: "passed",
    reason: null,
    decision: "none",
    ask: null,
    ms: 1,
    atMs: seq,
    size: 0,
    skippedBy: null,
    decisionText: null,
  };
}

function hookRow(stepIndex: number, seq: number): DeltaRow {
  return { kind: "hook", stepIndex, hook: hookRun(seq) };
}

const TURN_ROW: DeltaRow = { kind: "turn", status: "completed", complete: true };

function watchOf(sub: string, threadId: string): TurnWatch {
  return { sub, threadId };
}

/** 알림 하나의 기대 모양. `params`의 키 순서는 상관없다 */
function deltaOf(input: {
  readonly sub: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly stepIndex: number | null;
  readonly rows: readonly DeltaRow[];
  readonly final: boolean;
}): unknown {
  return {
    jsonrpc: "2.0",
    method: "turnRecord.delta",
    params: { ...input },
  };
}

function setup(phase: DeltaConnection["phase"] = "ready"): {
  readonly conn: TestConnection;
  readonly bus: ReturnType<typeof createTurnRecordEvents>;
  readonly clock: ReturnType<typeof manualScheduler>;
  readonly watch: TurnWatch;
} {
  const conn = connection(phase);
  const watch = watchOf("s1", "thr_a");
  conn.turnWatches.set(watch.sub, watch);
  const bus = createTurnRecordEvents(silentLogger());
  const clock = manualScheduler();
  startTurnWatchFanout({
    turnRecord: { onEvent: (listener) => bus.subscribe(listener) },
    scheduler: clock.scheduler,
    connections: () => [conn],
  });
  return { conn, bus, clock, watch };
}

function rowsEvent(
  threadId: string,
  turnId: string,
  stepIndex: number | null,
  rows: readonly DeltaRow[],
  final: boolean,
): TurnRecordEvent {
  return { kind: "rows", threadId, turnId, stepIndex, rows, final };
}

test("a watch gets the step rows after the coalescing window, then the turn row at once with final true", () => {
  const { conn, bus, clock } = setup();
  bus.emit(rowsEvent("thr_a", "trn_1", 0, [hookRow(0, 1)], false));
  bus.emit(rowsEvent("thr_a", "trn_1", 0, [hookRow(0, 2)], false));
  // 같은 턴과 단계의 행은 기다린다
  expect(conn.sent).toEqual([]);
  expect(clock.waiting()).toBe(1);
  clock.fireAll();
  expect(conn.sent).toEqual([
    deltaOf({
      sub: "s1",
      threadId: "thr_a",
      turnId: "trn_1",
      stepIndex: 0,
      rows: [hookRow(0, 1), hookRow(0, 2)],
      final: false,
    }),
  ]);
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent.slice(1)).toEqual([
    deltaOf({
      sub: "s1",
      threadId: "thr_a",
      turnId: "trn_1",
      stepIndex: null,
      rows: [TURN_ROW],
      final: true,
    }),
  ]);
  expect(TURN_DELTA_COALESCE_MS).toBe(100);
});

test("one notification carries at most 100 rows, and final is set only on the last piece of the turn row", () => {
  const { conn, bus, clock } = setup();
  const many = Array.from({ length: 250 }, (_, index) => hookRow(0, index + 1));
  expect(TURN_DELTA_MAX_ROWS).toBe(100);
  bus.emit(rowsEvent("thr_a", "trn_1", 0, many, false));
  clock.fireAll();
  const base = { sub: "s1", threadId: "thr_a", turnId: "trn_1", stepIndex: 0 };
  expect(conn.sent).toEqual([
    deltaOf({ ...base, rows: many.slice(0, 100), final: false }),
    deltaOf({ ...base, rows: many.slice(100, 200), final: false }),
    deltaOf({ ...base, rows: many.slice(200), final: false }),
  ]);
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent.length).toBe(4);
  expect(conn.sent.at(-1)).toEqual(
    deltaOf({
      sub: "s1",
      threadId: "thr_a",
      turnId: "trn_1",
      stepIndex: null,
      rows: [TURN_ROW],
      final: true,
    }),
  );
});

test("unwatch stops delivery, and rows still waiting for the window are dropped with it", () => {
  const { conn, bus, clock, watch } = setup();
  bus.emit(rowsEvent("thr_a", "trn_1", 0, [hookRow(0, 1)], false));
  conn.turnWatches.delete(watch.sub);
  clock.fireAll();
  expect(conn.sent).toEqual([]);
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent).toEqual([]);
});

test("a watch hears only its own thread", () => {
  const { conn, bus, clock } = setup();
  bus.emit(rowsEvent("thr_b", "trn_9", null, [TURN_ROW], true));
  clock.fireAll();
  expect(conn.sent).toEqual([]);
});

test("a connection that is not ready, or whose watches were cleared on close, gets nothing", () => {
  const { conn, bus } = setup();
  conn.turnWatches.clear();
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent).toEqual([]);

  // 이미 닫힌 연결에는 구독이 있어도 보내지 않는다
  const closed = setup("closed");
  closed.bus.emit(rowsEvent("thr_a", "trn_2", null, [TURN_ROW], true));
  expect(closed.conn.sent).toEqual([]);
});

test("removing a thread drops its watches quietly, and a later unwatch still answers", () => {
  const { conn, bus, watch } = setup();
  bus.emit({ kind: "thread_removed", threadId: "thr_a" });
  expect(conn.turnWatches.has(watch.sub)).toBe(false);
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent).toEqual([]);
});

test("a listener that throws is logged and does not stop the other listeners", () => {
  const warnings: { readonly event: string; readonly fields: unknown }[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields) => {
      warnings.push({ event, fields });
    },
    error: () => undefined,
    child: () => logger,
  };
  const bus = createTurnRecordEvents(logger);
  const conn = connection();
  conn.turnWatches.set("s1", watchOf("s1", "thr_a"));
  const clock = manualScheduler();
  bus.subscribe(() => {
    throw new Error("listener broke");
  });
  startTurnWatchFanout({
    turnRecord: { onEvent: (listener) => bus.subscribe(listener) },
    scheduler: clock.scheduler,
    connections: () => [conn],
  });
  bus.emit(rowsEvent("thr_a", "trn_1", null, [TURN_ROW], true));
  expect(conn.sent).toEqual([
    deltaOf({
      sub: "s1",
      threadId: "thr_a",
      turnId: "trn_1",
      stepIndex: null,
      rows: [TURN_ROW],
      final: true,
    }),
  ]);
  expect(warnings).toEqual([
    {
      event: "measure.turn_event_listener_failed",
      fields: { kind: "rows", message: "listener broke" },
    },
  ]);
});
