import { attempt, type Logger } from "@fresnel/contracts";
import type { DeltaRow, Unsubscribe } from "@fresnel/contracts/wire";
import { messageOf } from "../../util.ts";

// 턴 기록 쓰기의 읽기 전용 사건(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.5). 쓰기 묶음이 행을 쓴 뒤에 한 번 알린다.
// 구독 알림 `turnRecord.delta`의 원천이다. 리스너가 던져도 쓰기는 그대로 가고, 던진 것은 기록만 남긴다.

/** 턴 기록이 쓰인 한 번. `rows`는 그 쓰기가 낸 행이고, `final`은 턴 행을 실은 사건이다 */
export type TurnRecordEvent =
  | {
      readonly kind: "rows";
      readonly threadId: string;
      readonly turnId: string;
      readonly stepIndex: number | null;
      readonly rows: readonly DeltaRow[];
      readonly final: boolean;
    }
  /** 대화가 지워졌다. 그 대화의 구독은 조용히 끝난다 */
  | { readonly kind: "thread_removed"; readonly threadId: string };

export interface TurnRecordEvents {
  emit(event: TurnRecordEvent): void;
  subscribe(listener: (event: TurnRecordEvent) => void): Unsubscribe;
}

/** 사건 버스. 리스너 하나가 던져도 나머지 리스너와 쓰기 경로는 계속된다. 던진 것은 기록한다 */
export function createTurnRecordEvents(logger: Logger): TurnRecordEvents {
  const listeners = new Set<(event: TurnRecordEvent) => void>();
  return {
    emit(event) {
      for (const listener of Array.from(listeners)) {
        const delivered = attempt(() => listener(event));
        if (!delivered.ok) {
          logger.warn("measure.turn_event_listener_failed", {
            kind: event.kind,
            message: messageOf(delivered.error.cause),
          });
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
