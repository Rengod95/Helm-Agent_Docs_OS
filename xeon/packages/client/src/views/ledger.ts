// 화면 장부(ADR-0021 §3.7). 화면 하나가 연속으로 실패한 횟수를 세고, 연속 5번이면 그 화면만 `view_disabled`로 둔다.
// 클라이언트 메모리에만 있고 다시 켜기나 재시작으로 비운다. 확장 전체는 끄지 않는다. 화면 키는 "<확장이름>/<화면 id>"다.

/** 장부에 세는 실패 종류. 값(본문, 인자)은 담지 않고 이름만 센다 */
export const LEDGER_FAILURES = [
  "query_failed",
  "result_invalid",
  "render_exception",
  "ready_timeout",
  "bridge_format",
  "limit_exceeded",
  "liveness_lost",
  "frame_navigated",
  "confirm_denied",
  "confirm_timeout",
] as const;
export type LedgerFailure = (typeof LEDGER_FAILURES)[number];

/** 연속 실패가 이 값에 이르면 화면이 꺼진다 */
export const LEDGER_DISABLE_AFTER = 5;

export type ScreenLedgerState =
  | { readonly state: "active"; readonly consecutive: number }
  | { readonly state: "view_disabled"; readonly last: LedgerFailure };

export interface ScreenLedger {
  /** 실패 하나를 센다. 이 실패로 화면이 꺼졌으면 `true` */
  fail(key: string, failure: LedgerFailure): boolean;
  /** 성공 하나. 연속 횟수를 0으로 되돌린다. 이미 꺼진 화면은 그대로다 */
  succeed(key: string): void;
  stateOf(key: string): ScreenLedgerState;
  /** "다시 켜기" */
  reenable(key: string): void;
  clear(): void;
  /** 꺼진 화면이 생기거나 다시 켜질 때 부른다. 해제는 `reenable`이 부른 뒤 돌려준 함수로 한다 */
  subscribe(listener: (key: string, state: ScreenLedgerState) => void): () => void;
}

interface Entry {
  consecutive: number;
  disabledBy: LedgerFailure | undefined;
}

export function createScreenLedger(): ScreenLedger {
  const entries = new Map<string, Entry>();
  const listeners = new Set<(key: string, state: ScreenLedgerState) => void>();

  function stateOf(key: string): ScreenLedgerState {
    const entry = entries.get(key);
    if (entry === undefined) return { state: "active", consecutive: 0 };
    if (entry.disabledBy !== undefined) return { state: "view_disabled", last: entry.disabledBy };
    return { state: "active", consecutive: entry.consecutive };
  }
  function notify(key: string): void {
    const state = stateOf(key);
    for (const listener of listeners) listener(key, state);
  }

  return {
    fail(key, failure) {
      const entry = entries.get(key) ?? { consecutive: 0, disabledBy: undefined };
      entries.set(key, entry);
      if (entry.disabledBy !== undefined) return false;
      entry.consecutive += 1;
      if (entry.consecutive < LEDGER_DISABLE_AFTER) return false;
      entry.disabledBy = failure;
      notify(key);
      return true;
    },
    succeed(key) {
      const entry = entries.get(key);
      if (entry === undefined || entry.disabledBy !== undefined) return;
      entry.consecutive = 0;
    },
    stateOf,
    reenable(key) {
      const entry = entries.get(key);
      if (entry === undefined) return;
      entries.delete(key);
      notify(key);
    },
    clear() {
      const keys = [...entries.keys()];
      entries.clear();
      for (const key of keys) notify(key);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
