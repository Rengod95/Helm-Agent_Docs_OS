// 권한 교집합(L1.agents.spec §4.3, AG-3). 부모 관점 평가와 자식 관점 평가의 stricter 합성은 F `childDecision`이고
// core-tools 파이프라인이 `ToolRunContext.ceiling`이 있으면 부른다. 여기서는 그 입력(자식 모드, 부모 관점 상한)만 계산한다.
import {
  matchToolGlob,
  PERMISSION_MODE_STRICTNESS,
  type CallerId,
  type PermissionMode,
  type PolicyCeiling,
} from "@xeon/contracts/services";

/** 자식 모드: 부모 모드와 정의가 요청한 모드 중 엄격한 쪽. 부모가 plan이면 자식도 plan이다 */
export function childMode(
  parent: PermissionMode,
  requested: PermissionMode | undefined,
): PermissionMode {
  if (requested === undefined) return parent;
  const parentRank = PERMISSION_MODE_STRICTNESS.indexOf(parent);
  const requestedRank = PERMISSION_MODE_STRICTNESS.indexOf(requested);
  return requestedRank < parentRank ? requested : parent;
}

/**
 * 도구 이름 glob 목록의 교집합. 한쪽이 undefined(제한 없음)면 다른 쪽이다. 둘 다 있으면 한 목록의 glob이 다른 목록의 glob을
 * 글자 그대로 덮을 때(`*`가 `read*`를 덮는다) 더 좁은 쪽을 남긴다. 두 glob이 부분만 겹치는 경우(`rea*`와 `*d`)는 일치하는 글자 그대로의
 * 이름이 없어 빈 목록이 된다: 넓어지는 쪽으로는 틀리지 않는 보수적 근사다. 순수 함수
 */
export function intersectGlobs(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const kept = new Set<string>();
  for (const candidate of left) {
    if (right.some((glob) => matchToolGlob(glob, candidate))) kept.add(candidate);
  }
  for (const candidate of right) {
    if (left.some((glob) => matchToolGlob(glob, candidate))) kept.add(candidate);
  }
  return [...kept];
}

export interface CeilingInput {
  /** 부모 대화의 호출 주체와 깊이, 모드 */
  readonly parent: {
    readonly caller: CallerId;
    readonly depth: number;
    readonly mode: PermissionMode;
  };
  /** 정의의 tools 제한 */
  readonly definitionTools: readonly string[] | undefined;
  /** 호출자가 준 allow. 정의와의 교집합만 쓴다 */
  readonly requestAllow: readonly string[] | undefined;
}

/** 자식 `ToolRunContext.ceiling`: 부모 관점과 정의 제한(교집합) */
export function ceilingOf(input: CeilingInput): PolicyCeiling {
  const allow = intersectGlobs(input.definitionTools, input.requestAllow);
  return {
    caller: input.parent.caller,
    depth: input.parent.depth,
    mode: input.parent.mode,
    ...(allow === undefined ? {} : { allow }),
  };
}
