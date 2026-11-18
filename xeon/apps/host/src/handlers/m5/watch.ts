import type { Scheduler, TimerHandle } from "@fresnel/contracts";
import type { DeltaRow } from "@fresnel/contracts/wire";
import type { TurnRecordEvent } from "../../assembly/measure/turn-events.ts";
import type { TurnRecordReadPort } from "../../assembly/measure/turn-read.ts";
import type { ConnectionState, SendQueue, TurnWatch } from "../../connection-types.ts";
import { toRecord } from "../../util.ts";

// 턴 기록 구독의 알림 쪽(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.5). 턴 기록이 쓰인 사건을 받아
// 구독한 대화의 연결에 `turnRecord.delta`를 보낸다. 같은 턴과 단계의 연속 행은 `TURN_DELTA_COALESCE_MS` 동안 모아 한 알림으로 보내고,
// 한 알림에는 행을 `TURN_DELTA_MAX_ROWS`개까지 싣는다. 턴 행을 실은 사건은 기다리지 않고 바로 보낸다.
// 구독 목록은 연결마다 `turnWatches`에 있다. 연결이 닫히면 그 목록이 비고, 대화가 지워지면 그 대화의 구독을 뺀다.

/** 같은 턴의 행을 모으는 시간(ms) [제안] */
export const TURN_DELTA_COALESCE_MS = 100;
/** 한 알림의 행 상한(§3.5) */
export const TURN_DELTA_MAX_ROWS = 100;

/** 알림을 받을 연결의 모양. 연결 상태 전체가 아니라 이 자리가 쓰는 칸만 본다 */
export interface DeltaConnection {
  readonly phase: ConnectionState["phase"];
  readonly turnWatches: Map<string, TurnWatch>;
  readonly sender: Pick<SendQueue, "push">;
}

export interface TurnWatchFanoutDeps {
  readonly turnRecord: Pick<TurnRecordReadPort, "onEvent">;
  readonly scheduler: Scheduler;
  readonly connections: () => readonly DeltaConnection[];
}

interface Pending {
  readonly conn: DeltaConnection;
  readonly watch: TurnWatch;
  readonly turnId: string;
  readonly stepIndex: number | null;
  readonly rows: DeltaRow[];
  timer: TimerHandle | undefined;
}

/** 알림 하나를 보낸다. 행이 많으면 `TURN_DELTA_MAX_ROWS`씩 나누고, `final`은 턴 행을 실은 마지막 조각에만 붙인다 */
function sendDelta(pending: Pending, final: boolean): void {
  if (pending.conn.phase !== "ready") return;
  for (let at = 0; at < pending.rows.length; at += TURN_DELTA_MAX_ROWS) {
    const chunk = pending.rows.slice(at, at + TURN_DELTA_MAX_ROWS);
    const last = at + TURN_DELTA_MAX_ROWS >= pending.rows.length;
    pending.conn.sender.push({
      jsonrpc: "2.0",
      method: "turnRecord.delta",
      params: toRecord({
        sub: pending.watch.sub,
        threadId: pending.watch.threadId,
        turnId: pending.turnId,
        stepIndex: pending.stepIndex,
        rows: chunk,
        final: final && last,
      }),
    });
  }
}

/**
 * 턴 기록 사건을 구독 연결에 나눈다. 돌려주는 `stop`이 구독을 끊고 대기 중인 알림을 버린다.
 * 사건 버스의 리스너는 쓰기 묶음 안에서 불린다. 여기서는 보내기만 하고 저장소에는 쓰지 않는다.
 */
export function startTurnWatchFanout(deps: TurnWatchFanoutDeps): { readonly stop: () => void } {
  const { scheduler } = deps;
  /** 구독마다 모으는 행. 키는 구독 객체다(같은 구독은 같은 객체다) */
  const pendingOf = new Map<TurnWatch, Pending>();

  function flush(watch: TurnWatch, final: boolean): void {
    const pending = pendingOf.get(watch);
    if (pending === undefined) return;
    pendingOf.delete(watch);
    if (pending.timer !== undefined) scheduler.clearTimeout(pending.timer);
    // 구독이 그사이 사라졌으면(끊음, 연결 닫힘, 대화 삭제) 보내지 않는다
    if (pending.conn.turnWatches.get(watch.sub) !== watch) return;
    sendDelta(pending, final);
  }

  function enqueue(
    conn: DeltaConnection,
    watch: TurnWatch,
    event: Extract<TurnRecordEvent, { readonly kind: "rows" }>,
  ): void {
    let pending = pendingOf.get(watch);
    // 턴이나 단계가 바뀌면 앞의 묶음을 먼저 보낸다. 알림 하나는 한 턴의 한 단계만 가진다
    if (
      pending !== undefined &&
      (pending.turnId !== event.turnId || pending.stepIndex !== event.stepIndex)
    ) {
      flush(watch, false);
      pending = undefined;
    }
    if (pending === undefined) {
      pending = {
        conn,
        watch,
        turnId: event.turnId,
        stepIndex: event.stepIndex,
        rows: [],
        timer: undefined,
      };
      pendingOf.set(watch, pending);
    }
    pending.rows.push(...event.rows);
    if (event.final) {
      flush(watch, true);
      return;
    }
    if (pending.timer === undefined) {
      pending.timer = scheduler.setTimeout(() => {
        flush(watch, false);
      }, TURN_DELTA_COALESCE_MS);
    }
  }

  const off = deps.turnRecord.onEvent((event) => {
    if (event.kind === "thread_removed") {
      for (const conn of deps.connections()) {
        for (const [sub, watch] of conn.turnWatches) {
          if (watch.threadId === event.threadId) conn.turnWatches.delete(sub);
        }
      }
      return;
    }
    for (const conn of deps.connections()) {
      if (conn.phase !== "ready") continue;
      for (const watch of conn.turnWatches.values()) {
        if (watch.threadId !== event.threadId) continue;
        enqueue(conn, watch, event);
      }
    }
  });

  return {
    stop: () => {
      off();
      for (const pending of pendingOf.values()) {
        if (pending.timer !== undefined) scheduler.clearTimeout(pending.timer);
      }
      pendingOf.clear();
    },
  };
}
