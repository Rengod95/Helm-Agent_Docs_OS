import {
  assertNever,
  attemptAsync,
  detach,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";

// 비밀 값을 복사한 뒤 클립보드를 지우는 시한(L4.settings-ui 값 복사). 복사하면 `arm()`으로 시한을 건다.
// 시한이 지나면 `clear()`를 부른다. 창을 닫거나 앱을 숨길 때는 `flush()`로 지금 지운다.
// 지우기가 실패해도 예외를 밖으로 내지 않는다. `lastFailed()`로 화면이 알린다.

/** 복사한 값이 클립보드에 남는 시간 */
export const CLIPBOARD_CLEAR_MS = 30_000;

export type ClipboardClearDeps = {
  readonly scheduler: Scheduler;
  readonly clear: () => Promise<void>;
};

export interface ClipboardClear {
  /** 지우기 시한이 걸려 있는지 */
  armed(): boolean;
  /** 시한을 새로 건다. 걸려 있던 시한은 바꾼다 */
  arm(): void;
  /** 시한만 푼다. 클립보드는 지우지 않는다 */
  cancel(): void;
  /** 시한이 걸려 있으면 지금 지운다 */
  flush(): Promise<void>;
  /** 마지막 지우기가 실패했는지 */
  lastFailed(): boolean;
}

export function createClipboardClear(deps: ClipboardClearDeps): ClipboardClear {
  const state: { timer: TimerHandle | null; failed: boolean } = { timer: null, failed: false };

  /** 지우기 한 번. 실패는 플래그로만 남기고 던지지 않는다 */
  async function clearNow(): Promise<void> {
    const outcome = await attemptAsync(() => deps.clear());
    state.failed = !outcome.ok;
  }

  function dropTimer(): void {
    if (state.timer !== null) {
      deps.scheduler.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  return {
    armed(): boolean {
      return state.timer !== null;
    },
    arm(): void {
      dropTimer();
      state.timer = deps.scheduler.setTimeout(() => {
        state.timer = null;
        detach(clearNow(), () => {
          state.failed = true;
        });
      }, CLIPBOARD_CLEAR_MS);
    },
    cancel(): void {
      dropTimer();
    },
    async flush(): Promise<void> {
      if (state.timer === null) return;
      dropTimer();
      await clearNow();
    },
    lastFailed(): boolean {
      return state.failed;
    },
  };
}

// ── 업데이트 확인 줄 ───────────────────────────────────────────────────

/** 업데이트 확인 한 줄. 내려받기는 하지 않고 표시만 한다(결정 A2) */
export type UpdateCheckLine =
  | { readonly state: "unchecked" }
  | { readonly state: "checking" }
  | { readonly state: "latest"; readonly version: string }
  | { readonly state: "available"; readonly version: string; readonly current: string }
  | { readonly state: "failed" };

export type UpdateLineKey =
  | "desktop.update.unchecked"
  | "desktop.update.checking"
  | "desktop.update.latest"
  | "desktop.update.available"
  | "desktop.update.failed";

/** 업데이트 확인 줄의 메시지 키. 버전 문장은 화면이 채운다 */
export function updateLineKey(line: UpdateCheckLine): UpdateLineKey {
  switch (line.state) {
    case "unchecked":
      return "desktop.update.unchecked";
    case "checking":
      return "desktop.update.checking";
    case "latest":
      return "desktop.update.latest";
    case "available":
      return "desktop.update.available";
    case "failed":
      return "desktop.update.failed";
    default:
      return assertNever(line, "UpdateCheckLine");
  }
}
