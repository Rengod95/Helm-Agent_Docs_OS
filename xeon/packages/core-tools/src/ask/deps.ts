import type { Logger } from "@fresnel/contracts";
import type { CallContext } from "@fresnel/contracts/capabilities";
import type { OsTime } from "@fresnel/contracts/services";
import type { ApprovalsPortFactory } from "./approvals.ts";

/**
 * 시계와 지연 실행. 질문 시간 제한이 쓴다. 운영은 `fresnel.os`의 `time`을 그대로 넘기고,
 * 시험은 수동 시계를 넘긴다(eng.testing.guide TS-03).
 */
export type Timers = Pick<OsTime, "clock" | "scheduler">;

/**
 * 질문 서비스 조립에 필요한 의존. cap-dialog의 `DialogDeps`가 이 모양을 포함하므로 플러그인은 그대로 넘긴다.
 * 설정은 `ask.timeoutSec` 하나만 읽는다(cap-dialog 설정의 기본값은 0이다).
 */
export interface AskDeps {
  readonly logger: Logger;
  readonly timers: Timers;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: string | undefined) => {
    readonly ask: { readonly timeoutSec: number };
  };
  /** 없으면 `ask`는 unavailable로 거부한다 */
  readonly approvals: ApprovalsPortFactory | undefined;
  /** 사람이 승인 요청에 답할 수 있는 호출인가. 알 수 없으면 참이다 */
  readonly interactive: (context: CallContext) => boolean;
}
