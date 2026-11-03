// hooks.order.* 계약의 임시 사본. 원본은 m4/order 브랜치의
// xeon/packages/contracts/src/wire-settings/wire/ext-read.ts와 ext-read-methods.ts다.
// 계약이 아직 main에 없어서 옮겨 적었다. 브랜치가 머지되면 이 타입들을 @fresnel/contracts import로 바꾸고 이 파일을 지운다.
// 메서드 이름: hooks.order.get | set | reset | preview.

export const HOOK_ORDER_METHODS = {
  get: "hooks.order.get",
  set: "hooks.order.set",
  reset: "hooks.order.reset",
  preview: "hooks.order.preview",
} as const;

/** 저장된 덮어쓰기가 있거나 적용 중인 훅마다 한 줄 */
interface HookOrderEntry {
  readonly hook: string;
  readonly saved: readonly string[];
  readonly applied: readonly string[];
  readonly pending: boolean;
}

export interface HooksOrderGetResult {
  readonly hooks: readonly HookOrderEntry[];
}

export interface HooksOrderSetParams {
  readonly hook: string;
  readonly order: readonly string[];
}

export interface HooksOrderSetResult {
  readonly hook: string;
  readonly saved: readonly string[];
  readonly appliesAt: "nextStepBoundary";
}

/** hook을 생략하면 모든 훅이다 */
export interface HooksOrderResetParams {
  readonly hook?: string;
}

export interface HooksOrderResetResult {
  readonly hooks: readonly string[];
  readonly appliesAt: "nextStepBoundary";
}

export interface HooksOrderPreviewParams {
  readonly hook: string;
  readonly order: readonly string[];
}

/** 앞선 핸들러 하나 */
export interface HookOrderRef {
  readonly registrationId: string;
  readonly extension: string;
  readonly tier: number;
}

/** 건너뜀. 핸들러가 앞선 핸들러 때문에 실행되지 않을 수 있다 */
export interface HookSkipNote {
  readonly registrationId: string;
  readonly extension: string;
  readonly reason: "first_answer" | "first_failure_deny" | "chain_stop";
  readonly by: readonly HookOrderRef[];
}

/** 건너뜀이 아니라 값이 바뀔 수 있다는 뜻이다 */
interface HookValueChangeNote {
  readonly registrationId: string;
  readonly extension: string;
  readonly by: readonly HookOrderRef[];
}

/** closed first 훅에서 자동 끄기 대상이 실패하는 동안 가려지는 뒤 핸들러(affects) */
interface HookAutoDisableNote {
  readonly registrationId: string;
  readonly extension: string;
  readonly affects: readonly HookOrderRef[];
}

/** guard 핸들러의 위험. mayBeSkipped와 losesFirstPosition 중 하나라도 참이면 강한 경고다 */
interface HookGuardRiskNote {
  readonly registrationId: string;
  readonly extension: string;
  readonly mayBeSkipped: boolean;
  readonly losesFirstPosition: boolean;
  readonly by: readonly HookOrderRef[];
}

export interface HooksOrderPreviewResult {
  readonly hook: string;
  readonly order: readonly string[];
  readonly saveable: boolean;
  readonly skips: readonly HookSkipNote[];
  readonly valueChanges: readonly HookValueChangeNote[];
  readonly autoDisable: readonly HookAutoDisableNote[];
  readonly guardRisk: readonly HookGuardRiskNote[];
}

/** 순서 기능이 쓰는 wire 호출 넷. 전송 계층(클라이언트 연결)이 이것을 구현한다 */
export interface HookOrderPort {
  get(): Promise<HooksOrderGetResult>;
  set(params: HooksOrderSetParams): Promise<HooksOrderSetResult>;
  reset(params: HooksOrderResetParams): Promise<HooksOrderResetResult>;
  preview(params: HooksOrderPreviewParams): Promise<HooksOrderPreviewResult>;
}
