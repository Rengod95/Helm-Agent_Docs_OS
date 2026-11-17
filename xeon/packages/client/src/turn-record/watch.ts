import type { Result } from "@fresnel/contracts";
import type {
  RecordLevel,
  SubId,
  TurnRecordDeltaParams,
  WireRequestOptions,
} from "@fresnel/contracts/wire";
import { callTurnRecord, type TurnRecordConnection, type TurnRecordFailure } from "./call.ts";

// 열린 대화의 턴 기록을 구독한다(`turnRecord.watch`, 알림 `turnRecord.delta`). 구독 id(`sub`)가 알림을 가른다.

/** 구독 하나. `unwatch`는 알림 수신을 멈추고 `turnRecord.unwatch`를 보낸다 */
export interface TurnRecordWatch {
  readonly sub: SubId;
  readonly level: RecordLevel;
  /**
   * 알림 수신을 멈추고 구독을 닫는다. 멈춘 뒤에는 `onDelta`가 다시 불리지 않는다.
   * 두 번째 호출은 아무것도 하지 않고 성공을 돌려준다. 서버 쪽 해제가 실패하면 그 실패를 돌려준다.
   */
  readonly unwatch: () => Promise<Result<void, TurnRecordFailure>>;
}

interface WatchState {
  /** `turnRecord.watch`의 응답을 받기 전에는 null이다 */
  sub: SubId | null;
  /** 응답을 기다리는 동안 온 알림. 응답 뒤에 구독 id가 맞는 것만 넘긴다 */
  early: readonly TurnRecordDeltaParams[];
  stopped: boolean;
}

/**
 * 대화의 턴 기록 변화를 받는다. `onDelta`는 이 구독의 알림마다 한 번 불린다(다른 구독의 알림은 거른다).
 * 알림 리스너는 응답을 기다리기 전에 붙이므로, 응답보다 먼저 온 알림도 응답 뒤에 넘긴다.
 * 턴을 고르는 일은 호출자가 한다. 알림의 `turnId`를 본다.
 */
export async function watchTurnRecord(
  connection: TurnRecordConnection,
  threadId: string,
  onDelta: (params: TurnRecordDeltaParams) => void,
  options?: WireRequestOptions,
): Promise<Result<TurnRecordWatch, TurnRecordFailure>> {
  const state: WatchState = { sub: null, early: [], stopped: false };
  const off = connection.onNotification("turnRecord.delta", (params) => {
    if (state.sub === null) {
      state.early = [...state.early, params];
      return;
    }
    if (params.sub === state.sub) onDelta(params);
  });

  const watched = await callTurnRecord(connection, "turnRecord.watch", { threadId }, options);
  if (!watched.ok) {
    off();
    return { ok: false, error: watched.error };
  }
  const sub = watched.value.sub;
  state.sub = sub;
  const queued = state.early;
  state.early = [];
  for (const params of queued) {
    if (params.sub === sub) onDelta(params);
  }

  const unwatch = async (): Promise<Result<void, TurnRecordFailure>> => {
    if (state.stopped) return { ok: true, value: undefined };
    state.stopped = true;
    off();
    const released = await callTurnRecord(connection, "turnRecord.unwatch", { sub }, options);
    if (!released.ok) return { ok: false, error: released.error };
    return { ok: true, value: undefined };
  };
  return { ok: true, value: { sub, level: watched.value.level, unwatch } };
}
