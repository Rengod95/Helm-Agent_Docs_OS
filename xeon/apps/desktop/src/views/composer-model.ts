import { t } from "@xeon/client/i18n";
import type { Link } from "../state/engine/index.ts";
import { setupRequiredText } from "./setup-needed.ts";

// 입력창의 Enter 판정과 중복 전송 방지. 화면 부품에서 떼어 순수하게 시험한다.
// WebKit(Safari, WKWebView)은 한글 조합 중 Enter에서 compositionend를 keydown보다 먼저 내고,
// 그 keydown은 isComposing이 거짓이지만 keyCode가 229다. 그래서 세 단서를 모두 본다.

export type EnterKeyInput = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
};

export type EnterGuard = {
  compositionStart(): void;
  /** nowMs는 이벤트 시각(event.timeStamp)이다 */
  compositionEnd(nowMs: number): void;
  /** 이 keydown이 "보내기" Enter인가 */
  isSendEnter(event: EnterKeyInput, nowMs: number): boolean;
};

/** compositionend 직후 이 시간 안의 Enter는 조합을 확정한 키다 */
export const COMPOSITION_END_GRACE_MS = 50;
const IME_PROCESS_KEY_CODE = 229;

export function createEnterGuard(): EnterGuard {
  let composing = false;
  let endedAt = Number.NEGATIVE_INFINITY;
  return {
    compositionStart() {
      composing = true;
    },
    compositionEnd(nowMs) {
      composing = false;
      endedAt = nowMs;
    },
    isSendEnter(event, nowMs) {
      if (event.key !== "Enter" || event.shiftKey) return false;
      if (composing || event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE) return false;
      return nowMs - endedAt > COMPOSITION_END_GRACE_MS;
    },
  };
}

/** 한 번에 하나만 실행하는 잠금. 상태(setState)는 비동기라 연속 입력을 못 막으므로 ref 값으로 막는다 */
export type SendLatch = { tryAcquire(): boolean; release(): void };

export function createSendLatch(): SendLatch {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

/** 입력창을 잠그는 이유. null이면 보낼 수 있다 */
export function composerDisabledReason(input: {
  readonly engineRunning: boolean;
  readonly phase: Link["phase"];
  readonly observing: boolean;
  readonly setupNeeded: boolean;
}): string | null {
  if (!input.engineRunning) return t("desktop.composer.disabled.engineOff");
  if (input.phase !== "live" && input.phase !== "syncing")
    return t("desktop.composer.disabled.syncing");
  if (input.observing) return t("desktop.composer.disabled.observing");
  if (input.setupNeeded) return setupRequiredText();
  return null;
}
