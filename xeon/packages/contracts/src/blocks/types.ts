import type { BlockId, BoundaryId, HookPositionRow } from "../extensions/hook-positions.ts";
import type { HookName } from "../extensions/hooks.ts";

// 블록 모델의 타입(M5e 스펙 §4.8). 순수 타입이다. 값은 `blocks.ts`의 BLOCK_MODEL 하나뿐이다.

/** 한국어와 영어 표기 */
interface BlockLabel {
  readonly ko: string;
  readonly en: string;
}

/** 설정 범위. `thread` 범위는 없다. 우선순위 managed > launch > profile > local > project > user > default (M5c §3.3이 profile을 더한다) */
export type SettingRefScope = "managed" | "launch" | "profile" | "local" | "project" | "user";

export interface SettingRef {
  /** 설정 키. 부록 A와 각 패키지 정의의 실제 키다 */
  readonly key: string;
  /** 이 키를 정의한 패키지 이름. l1 키는 core-*, l0 키는 platform-*, l2 키는 cap-*, x 키는 ext-host */
  readonly owner: string;
  readonly scope: readonly SettingRefScope[];
}

/** 블록이 모델 컨텍스트나 실행 환경에 넣는 것의 종류 */
export type InjectKind =
  | "instructions"
  | "skill"
  | "tool"
  | "mcp-server"
  | "agent-definition"
  | "model-provider"
  | "web-provider"
  | "command"
  | "ui";

export interface ReplaceablePart {
  /** 예: "tool:edit", "summarizer", "web-search-provider" */
  readonly id: string;
  readonly label: BlockLabel;
  /** 매니페스트 `replaces`, 제공자 등록, 훅으로 대체 */
  readonly how: "replaces" | "provider" | "hook";
  /** 기본 구현. "core" 또는 기본 설치 플러그인 이름 */
  readonly default: string;
}

/** 블록이 지키는 바닥. 플러그인이 바꿀 수 없다 */
export interface Guarantee {
  readonly id: string;
  readonly text: BlockLabel;
}

export interface BlockDescription {
  readonly id: BlockId;
  readonly label: BlockLabel;
  /** 설정 겹 */
  readonly settings: readonly SettingRef[];
  /** 주입 겹 */
  readonly inject: readonly InjectKind[];
  /** 부품 교체 겹 */
  readonly parts: readonly ReplaceablePart[];
  /** 앞뒤 훅 겹. `hooks.before/after/events`는 HOOK_POSITIONS에서 파생한다 */
  readonly hooks: {
    readonly before: readonly HookName[];
    readonly after: readonly HookName[];
    /** 이 블록에 닻을 둔 이벤트. 기록 블록은 닻이 없는 이벤트 구독이 여기 든다 */
    readonly events: readonly HookName[];
  };
  readonly guarantees: readonly Guarantee[];
}

export interface BoundaryDescription {
  readonly id: BoundaryId;
  readonly label: BlockLabel;
  readonly hooks: readonly HookName[];
}

export interface BlockModel {
  readonly version: 1;
  /** 여섯: context, model, tools, ask, agents, record */
  readonly blocks: readonly BlockDescription[];
  /** 셋 */
  readonly boundaries: readonly BoundaryDescription[];
  /** HOOK_POSITIONS 전체, 이름 순서는 HOOK_NAMES와 같다 */
  readonly positions: readonly HookPositionRow[];
}
