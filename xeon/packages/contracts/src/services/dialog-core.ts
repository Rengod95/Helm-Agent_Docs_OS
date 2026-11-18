import type { Bug, Logger } from "../base/index.ts";
import type {
  CallContext,
  CapabilityApi,
  CapabilityError,
  CapabilityId,
  DialogAsk,
} from "../capabilities/index.ts";
import type { ApprovalService, L2ApprovalsPort } from "./approvals.ts";
import type { OsTime } from "./os.ts";

// 대화 기능(dialog)의 질문 서비스 조립 모양. 구현은 core-tools(`ask/`)에 있고, cap-dialog(P)는 이 타입들과
// `DialogCore`만 받아 쓴다. 조립 루트가 `dialogPlugin({ core: dialogCore })`로 구현을 넘긴다(DR-15).

/**
 * 시계와 지연 실행. 질문 시간 제한이 쓴다. 운영은 `fresnel.os`의 `time`을 그대로 넘기고,
 * 시험은 수동 시계를 넘긴다(eng.testing.guide TS-03).
 */
export type Timers = Pick<OsTime, "clock" | "scheduler">;

/**
 * 승인 프로토콜(`fresnel.approvals`, kind `question`)을 쓰는 유일한 자리(L2.dialog.spec §4.1.1).
 * 포트 모양은 F의 L2 공통 `L2ApprovalsPort`(L2.readme §5.7)다. 이 포트는 요청이 낸 쪽(출처)을 호출마다 정해야 해서
 * 호출 문맥으로 포트를 만드는 팩토리로 받는다: 도구 호출 안이면 문맥의 `toolCallId`·`turnId`가 요청의 `origin`이 되어
 * L1.tools가 그 호출의 대기 체크포인트를 같은 커밋에 넣는다.
 *
 * 기본 구현은 core-tools의 `questionApprovalsOver`다. 조립 루트는 이 팩토리를 `dialogPlugin({ approvals })`로 바꿔 넣을 수도 있다.
 */
export interface ApprovalsPortFactory {
  forCall(context: CallContext | undefined): L2ApprovalsPort;
}

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

/** 질문 서비스. `api`는 `dialog.ask` 기능의 메서드이고, `dispose`는 대기 중인 시간 제한을 거둔다 */
export interface AskService {
  readonly api: CapabilityApi<typeof DialogAsk>;
  dispose(): void;
}

/**
 * cap-dialog가 받는 대화 기능 묶음. 구현(core-tools `dialogCore`)을 조립 루트가 넘긴다. 플러그인은 구현 패키지를 import하지 않는다.
 * 경계 변환 두 가지는 파일 시스템 실패(`FileError`)를 알아야 해서 F에 둘 수 없다(F의 import 순서). 구현은 core-tools의 `ask/errors.ts`다.
 */
export interface DialogCore {
  createAskService(deps: AskDeps): AskService;
  /** `fresnel.approvals`를 질문 승인용 포트 팩토리로 감싼다. 플러그인이 `approvals` 옵션을 생략했을 때 쓴다 */
  questionApprovalsOver(approvals: ApprovalService): ApprovalsPortFactory;
  /** 메서드 본문을 실행하고 실패를 `CapabilityError`로 거부한다(core-tools `guarded`와 같다) */
  guardedDialog<T>(capability: CapabilityId, method: string, run: () => Promise<T>): Promise<T>;
  /** 던져진 값을 메서드의 `CapabilityError`로 바꾼다(core-tools `toCapabilityError`와 같다) */
  toDialogCapabilityError(
    capability: CapabilityId,
    method: string,
    caught: unknown,
  ): CapabilityError | Bug;
}
