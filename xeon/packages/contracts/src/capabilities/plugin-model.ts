import type { StopReason, ThreadId } from "../conversation/index.ts";

// 플러그인이 주도 단계의 `model` 명령으로 부르는 모델 호출 한 번의 값(drive-isolation.md §1.2). 소비는 ext-host의 엔진이고
// (ModelsPort, extensions), 구현은 core-models다. 역할 해석과 제공자 호출은 구현이 맡는다.
// 오류 종류는 services/models.ts의 `ModelErrorKind` 값을 싣되 이 층은 services를 가져오지 않으므로 문자열로 둔다.

/** 호출 메시지 하나. 시스템 메시지는 합쳐 시스템 지침이 되고, 사용자와 어시스턴트 메시지는 순서대로 대화가 된다 */
export interface PluginModelMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface PluginModelRequest {
  readonly threadId: ThreadId;
  /** 호출한 플러그인. `scopeId`는 등록 id다: 사용량 귀속과 재생 멱등 키 (scopeId, requestId)의 범위가 된다 */
  readonly plugin: { readonly name: string; readonly scopeId: string };
  /** 1~64자. 같은 대화의 같은 (scopeId, requestId)는 이 프로세스 안에서 한 번만 호출하고 저장된 결과를 돌려준다 */
  readonly requestId: string;
  readonly messages: readonly PluginModelMessage[];
  /** 턴 기록에 남는 자유 문자열(drive-isolation.md §1.2) */
  readonly label?: string;
  readonly signal?: AbortSignal;
}

export interface PluginModelUsage {
  readonly input: number;
  readonly output: number;
  /** 제공자가 보고한 총 토큰. 주도 한도 차감에 쓴다 */
  readonly total: number;
}

/** 모델 응답의 값. 단계 함수가 `last`로 받는 모양이기도 하다 */
export interface PluginModelValue {
  /** 응답의 글 블록을 이은 값. 도구 호출은 없다 */
  readonly text: string;
  readonly usage: PluginModelUsage | null;
  /** `length`면 응답이 잘린 것이다. 단계 함수가 볼 수 있게 그대로 싣는다 */
  readonly stopReason: StopReason;
}

export interface PluginModelResult extends PluginModelValue {
  /** 같은 대화의 같은 (scopeId, requestId)의 이 프로세스 안 재생이면 참. 토큰을 다시 차감하지 않게 호출자가 쓴다 */
  readonly replayed: boolean;
}

/**
 * 호출이 결과를 내지 못한 이유. `kind`는 역할·설정 해석 오류(`no_model_for_role` 등), `denied_by_guard`(`guard.model.before`가 막음),
 * 호출 오류 분류(`aborted`, `auth`, `rate_limited`, `provider_error` 등)의 값이다. 값 목록은 services/models.ts `ModelErrorKind`와 같다
 */
export interface PluginModelError {
  readonly kind: string;
  readonly message: string;
}
