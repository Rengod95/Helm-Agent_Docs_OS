import type { Scheduler, TimerHandle } from "@fresnel/contracts";

// 화면 다시 읽기 알림 `ext.ui.changed`를 묶는다(ADR-0021 §3.4.2, AGE-78). 같은 확장의 커밋 신호가 창 안에 여럿 오면
// 창이 닫힐 때 한 번만 보낸다. 창은 확장마다 첫 신호에서 열고, 창 밖의 신호는 새 창을 연다.
// 끝 가장자리에 보내므로 창이 닫힐 때의 읽기는 창 안의 모든 커밋 뒤에 있다. 시간은 주입된 scheduler로 재므로 시험은 가짜 시간으로 돈다.

/** 묶는 창(ms). 같은 확장의 연속 커밋이 이 안에 몰리면 알림은 한 번이다 */
export const UI_CHANGE_WINDOW_MS = 100;

export interface UiChangeCoalescer {
  /** 확장이 바뀌었다고 알린다. 그 확장의 창이 열려 있으면 더하지 않는다 */
  signal(extension: string): void;
  /** 열린 창을 모두 닫는다. 알리지 않는다(호스트 종료 때 부른다) */
  dispose(): void;
}

export interface UiChangeCoalescerOptions {
  readonly windowMs: number;
  readonly scheduler: Scheduler;
  /** 창이 닫힐 때 확장마다 한 번 부른다 */
  readonly emit: (extension: string) => void;
}

export function createUiChangeCoalescer(options: UiChangeCoalescerOptions): UiChangeCoalescer {
  const { windowMs, scheduler, emit } = options;
  const windows = new Map<string, TimerHandle>();
  return {
    signal(extension) {
      if (windows.has(extension)) return;
      const handle = scheduler.setTimeout(() => {
        windows.delete(extension);
        emit(extension);
      }, windowMs);
      windows.set(extension, handle);
    },
    dispose() {
      for (const handle of windows.values()) scheduler.clearTimeout(handle);
      windows.clear();
    },
  };
}
