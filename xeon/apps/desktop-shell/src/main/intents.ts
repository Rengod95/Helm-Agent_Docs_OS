// 셸 의도 큐(shell_intent.rs 대응). 트레이 "새 대화", 알림 클릭 "이 대화 열기"가 UI에 요청하는 길이다.
// 창이 닫혀 있으면 UI가 없으므로 셸이 들고 있다가 새 UI가 `shell_take_intents`로 가져간다. 가져가지 못한 의도는 30초 뒤 버린다.

export type Intent =
  | { readonly kind: "newThread" }
  | { readonly kind: "openThread"; readonly threadId: string };

/** 큐가 들 수 있는 의도 수. 넘으면 오래된 것부터 버린다 */
export const INTENT_CAPACITY = 8;
/** 의도가 살아 있는 시간(ms) */
export const INTENT_LIFETIME_MS = 30_000;
/** 떠 있는 UI를 깨우는 이벤트 이름(Tauri와 같다) */
export const INTENT_EVENT = "shell-intent";

export interface IntentQueue {
  /** 끝이 같은 `openThread`면 새로 넣지 않고 시각만 `now`로 바꾼다 */
  push(intent: Intent, now: number): void;
  /** 살아 있는 의도를 넣은 순서대로 모두 꺼내고 비운다 */
  take(now: number): Intent[];
}

interface Entry {
  intent: Intent;
  at: number;
}

export function createIntentQueue(): IntentQueue {
  let items: Entry[] = [];
  return {
    push(intent, now) {
      const last = items.at(-1);
      if (
        last !== undefined &&
        intent.kind === "openThread" &&
        last.intent.kind === "openThread" &&
        last.intent.threadId === intent.threadId
      ) {
        last.at = now;
        return;
      }
      items.push({ intent, at: now });
      if (items.length > INTENT_CAPACITY) items = items.slice(items.length - INTENT_CAPACITY);
    },
    take(now) {
      const taken = items;
      items = [];
      return taken
        .filter((entry) => now - entry.at <= INTENT_LIFETIME_MS)
        .map((entry) => entry.intent);
    },
  };
}

/** 의도 큐를 앱 하나가 공유한다. 트레이·알림·단일 인스턴스 모듈이 같은 큐에 넣고 `shell_take_intents`가 비운다 */
export const sharedIntents: IntentQueue = createIntentQueue();
