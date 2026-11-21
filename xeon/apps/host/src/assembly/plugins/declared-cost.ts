import { textTokens } from "@fresnel/core-context";

// 선언된 재료의 정적 비용(토큰 어림값). 플러그인 카드(`buildPluginCard`)와 프로필 미리 보기(`pluginCostOf`)가 같은 계산을 쓴다.
// 토큰은 조립과 턴 기록이 쓰는 어림(`textTokens`, 글자 수 / 4 올림)이다.

/** 선언된 도구 하나. 모델이 보는 정의 중 정적으로 아는 것은 이름과 설명뿐이다(인자 스키마는 코드가 실행돼야 안다) */
interface DeclaredCostTool {
  readonly name: string;
  readonly description: string;
}

/** 스킬 하나. `description`은 색인에 실리는 줄이고 `body`는 모델이 읽을 때 실리는 본문이다 */
interface DeclaredCostSkill {
  readonly description: string;
  readonly body: string;
}

export interface DeclaredCostInput {
  readonly tools: readonly DeclaredCostTool[];
  /** 항상 싣는 지침 파일의 내용 */
  readonly instructions: readonly string[];
  readonly skills: readonly DeclaredCostSkill[];
}

export interface DeclaredCost {
  readonly always: number;
  readonly onDemand: number;
  readonly toolCount: number;
}

/**
 * - always = 지침 토큰 + 선언된 도구(이름, 줄바꿈, 설명) 토큰
 * - onDemand = 스킬마다 설명 토큰 + 본문 토큰
 * - toolCount = 선언된 도구 수
 * Drive 중에만 싣는 양은 정적 근거가 없어 여기서 내지 않는다
 */
export function declaredCostOf(input: DeclaredCostInput): DeclaredCost {
  let always = 0;
  for (const tool of input.tools) always += textTokens(`${tool.name}\n${tool.description}`);
  for (const text of input.instructions) always += textTokens(text);
  let onDemand = 0;
  for (const skill of input.skills) {
    onDemand += textTokens(skill.description) + textTokens(skill.body);
  }
  return { always, onDemand, toolCount: input.tools.length };
}
