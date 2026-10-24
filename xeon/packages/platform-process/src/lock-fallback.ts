import type { LockBusy } from "@xeon/contracts/records";

// L0.process.spec §3.2·§4.5, L0.process.plan PR-15. 세션 잠금 실패 때 무엇을 할지 정하는 순수 함수.
// store는 LockBusy 정보만 돌려주고, 위임·관찰·분기 선택은 여기서 정한다. 실행은 L4·L1이 한다.

export type LockFallbackChoice = "delegate" | "observe" | "fork";
/** `l0.process.lockFallback.default` */
export type LockFallbackDefault = "ask" | "observe" | "fork";

export interface LockFallbackContext {
  readonly busy: LockBusy;
  /** 지금 클라이언트가 공유 서비스에 접속해 있고 그 서비스가 소유자인가 */
  readonly serviceOwnsSession: boolean;
  /** 사용자에게 물을 수 있는가 */
  readonly interactive: boolean;
  /** 명령줄·UI에서 명시한 선택 */
  readonly requested: LockFallbackChoice | null;
}

export type LockFallbackDecision =
  | { readonly kind: "act"; readonly choice: LockFallbackChoice }
  | {
      readonly kind: "ask";
      readonly options: readonly LockFallbackChoice[];
      readonly suggested: LockFallbackChoice;
    };

export interface LockFallbackPolicy {
  decide(context: LockFallbackContext): LockFallbackDecision;
}

/** 묻는 경우의 선택지. 위임은 서비스가 소유자일 때만 성립하고 그때는 묻지 않고 바로 위임하므로 목록에 없다 */
const ASK_OPTIONS: readonly LockFallbackChoice[] = ["observe", "fork"];

function suggestionFor(fallback: LockFallbackDefault): LockFallbackChoice {
  return fallback === "ask" ? "observe" : fallback;
}

export function createLockFallbackPolicy(settings: {
  readonly default: LockFallbackDefault;
}): LockFallbackPolicy {
  return {
    decide(context) {
      const suggested = suggestionFor(settings.default);
      if (context.requested !== null) {
        // 서비스가 소유자가 아닌데 위임을 요청하면 보낼 곳이 없으므로 다시 묻는다
        if (context.requested === "delegate" && !context.serviceOwnsSession) {
          return { kind: "ask", options: ASK_OPTIONS, suggested };
        }
        return { kind: "act", choice: context.requested };
      }
      if (context.serviceOwnsSession) return { kind: "act", choice: "delegate" };
      if (context.interactive) return { kind: "ask", options: ASK_OPTIONS, suggested };
      return { kind: "act", choice: suggested };
    },
  };
}

/** wire 오류 `thread.locked`(3002)의 `details`. `options`는 결정의 선택지 목록과 같다 */
export interface ThreadLockedDetails {
  readonly ownerKind: string;
  readonly options: readonly LockFallbackChoice[];
}

export function threadLockedDetails(
  busy: LockBusy,
  decision: LockFallbackDecision,
): ThreadLockedDetails {
  return {
    ownerKind: busy.owner?.kind ?? "unknown",
    options: decision.kind === "ask" ? decision.options : [decision.choice],
  };
}
