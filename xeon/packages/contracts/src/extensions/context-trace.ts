// 조립 재료와 도구 광고의 읽기 전용 싱크(정본 docs/xeon/review/m5/turn-record-metrics.md §3.2, §4.1 규칙 2·7, §4.5 규칙 26~29).
// core-loop가 단계의 모델 요청을 조립한 뒤 `step_context` 한 줄을, 단계 끝에 스킬 본문 읽기 호출마다 `skill_read` 한 줄을 넘긴다.
// 한 방향 호출이고 반환값은 호출 경로로 돌아가지 않는다. 재료 본문, 도구 설명, 인자 값은 싣지 않는다(이름과 어림 토큰만).
// 판정 목록과 같은 이유로 이 파일은 턴 기록 와이어(`wire/turn-record.ts`)를 가져다 쓰지 않는다. 모양이 같으면 구조적으로 맞는다.

/** 스킬 본문을 읽는 도구 이름. 모델이 `skill_view`를 부르면 그 호출의 `name` 인자가 스킬 이름이다 */
export const SKILL_VIEW_TOOL_NAME = "skill_view" as const;

/** 재료 한 덩어리의 사실(§3.2 `Material`). 값 자체는 없다 */
export interface ContextMaterialFact {
  /** 소유 플러그인 이름. 정할 수 없으면 `none`이다 */
  readonly plugin: string;
  /** 버전 정체. 로더가 낼 때까지 null이다 */
  readonly versionId: string | null;
  readonly registrationId: string | null;
  readonly kind: "always" | "drive" | "on_demand";
  readonly material:
    | "instruction"
    | "skill_index"
    | "skill_body"
    | "memory"
    | "hook_text"
    | "tool_defs";
  /** 사람이 알아볼 이름(절 경로, 훅 지점 이름 등). 내용이 아니다 */
  readonly ref: string;
  /** 글자 수 / 4 올림(요청 구성 토큰과 같은 어림) */
  readonly tokens: number;
  readonly truncated: boolean;
  readonly omitted: number | null;
  readonly itemId: string | null;
  readonly attribution: "declared" | "inferred" | "shared";
}

/** 광고 도구 한 줄. 이름과 소유자, 어림 토큰, 상태만 싣는다 */
export interface AdvertisedToolFact {
  readonly name: string;
  readonly plugin: string;
  readonly tokens: number;
  readonly state: "advertised" | "deferred" | "activated";
}

/** 광고 요약(§3.2 `Advertised`). `tools`는 상한 안의 줄이고 넘은 도구 수는 `toolsOmitted`다 */
export interface AdvertisedFact {
  readonly count: number;
  readonly tokens: number;
  readonly deferredCount: number;
  readonly removedCount: number;
  readonly fingerprint: string;
  readonly byPlugin: readonly {
    readonly plugin: string;
    readonly count: number;
    readonly tokens: number;
    readonly deferred: number;
    readonly activated: number;
  }[];
  readonly tools: readonly AdvertisedToolFact[];
  readonly toolsOmitted: number;
}

/** 측정 싱크로 가는 사건. 턴과 단계를 함께 싣는다(없는 턴의 호출은 기록기가 버린다) */
export type ContextTraceEvent =
  | {
      readonly kind: "step_context";
      readonly threadId: string;
      readonly turnId: string;
      readonly stepId: string;
      readonly materials: readonly ContextMaterialFact[];
      readonly advertised: AdvertisedFact;
    }
  | {
      readonly kind: "skill_read";
      readonly threadId: string;
      readonly turnId: string;
      readonly stepId: string;
      /** 스킬 본문을 읽은 도구 호출 id. 기록기가 같은 id의 호출 줄에서 판정과 결과 토큰을 얻는다 */
      readonly toolCallId: string;
      /** `skill_view`의 `name` 인자 */
      readonly name: string;
    };

/** 조립 재료와 광고를 받는 싱크. 읽기 전용이다. 구현은 호출 경로의 값을 바꾸지 않아야 하고, 실패는 호출자가 경고로 흡수한다 */
export interface ContextTraceSink {
  record(event: ContextTraceEvent): void;
}
