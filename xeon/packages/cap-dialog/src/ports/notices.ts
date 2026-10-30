import type { Result } from "@xeon/contracts";
import type { NoticeKind } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, ReadFailure, StoreError } from "@xeon/contracts/records";

// L2.dialog.spec §3.7, §4.7. 내구 알림(`dialog.notified`)을 남기고 원인 이벤트를 당겨 읽는 좁은 포트다.
// 구현은 `xeon.session`을 감싼 어댑터(session-adapter.ts)다. 시험은 메모리 대역을 넘긴다.

/** `dialog.notified` payload의 `notice`. DialogNotifiedSchema와 같은 모양이다 */
export interface NoticeRecord {
  readonly kind: NoticeKind;
  readonly title: string;
  readonly body: string | null;
  /** 알림을 낸 쪽. 그룹 이름이나 확장 이름이다 */
  readonly origin: string;
}

/** emit 실패. `key_reused`는 같은 requestId로 다른 알림을 보낸 호출자의 버그다(spec §5 3번) */
export type NoticeEmitFailure =
  | { readonly kind: "key_reused"; readonly requestId: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "store"; readonly error: StoreError };

export interface NoticeReadFilter {
  readonly threadId?: ThreadId;
  /** 돌려줄 내구 이벤트의 최대 수 */
  readonly limit: number;
  /** 훑을 최대 행 수. 알림 종류가 아닌 행도 센다 */
  readonly scanLimit: number;
}

export interface NoticeReadPage {
  /** afterSeq 뒤의 알림 원인 종류 이벤트, seq 오름차순 */
  readonly events: readonly DurableEventEnvelope[];
  /** 훑은 마지막 seq. 아무것도 훑지 않았으면 afterSeq다 */
  readonly scannedTo: number;
}

export interface NoticePort {
  /**
   * `dialog.notified`를 커밋하고 기록된 이벤트를 돌려준다. requestId가 있으면 커밋 키 `dialog:notify:<requestId>`로
   * 멱등이다. 같은 키의 재호출은 처음 기록된 이벤트를 돌려주고 새로 쓰지 않는다. 없으면 키가 고유해 매번 새 알림이 된다.
   */
  emit(
    threadId: ThreadId,
    record: NoticeRecord,
    requestId: string | undefined,
  ): Result<DurableEventEnvelope, NoticeEmitFailure>;
  /** afterSeq 뒤의 내구 이벤트를 커밋 순서로 읽는다. 알림 분류는 호출자가 한다 */
  read(afterSeq: number, filter: NoticeReadFilter): Result<NoticeReadPage, ReadFailure>;
}
