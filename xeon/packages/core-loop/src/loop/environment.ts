// L1.loop.spec §4.2 규칙 1a. 접두에 넣지 않는 요청별 안내 두 가지를 만든다: 환경 블록과 `before_agent_start`가 붙인 프롬프트.
// 둘 다 volatile 계층(`AssembleOptions.volatile`)으로 가서 단계마다 대화 끝에 붙고 커밋하지 않는다. 접두는 기본 프롬프트와
// 도구만 담으므로 turn마다 다른 값이 캐시를 깨지 않고, 둘째 대화부터 사라지지도 않는다(M2 마감 G2-03, 감사 L1-03).

export interface EnvironmentFacts {
  /** 단계를 여는 시각(epoch ms) */
  readonly now: number;
  /** 대화의 작업 디렉터리. 모르면 줄을 내지 않는다 */
  readonly workingDirectory: string | undefined;
  /** 예: "darwin/arm64". 모르면 줄을 내지 않는다 */
  readonly platform: string | undefined;
}

/** `environment` volatile 항목의 본문. 날짜는 UTC 기준이다. 같은 입력이면 같은 문자열이다 */
export function environmentText(facts: EnvironmentFacts): string {
  const lines = [`date: ${new Date(facts.now).toISOString().slice(0, 10)} (UTC)`];
  if (facts.workingDirectory !== undefined && facts.workingDirectory !== "") {
    lines.push(`working_directory: ${facts.workingDirectory}`);
  }
  if (facts.platform !== undefined && facts.platform !== "") {
    lines.push(`platform: ${facts.platform}`);
  }
  return lines.join("\n");
}

/**
 * `before_agent_start` 체인이 돌려준 시스템 프롬프트에서 기본 프롬프트에 더해진 부분. 핸들러가 기본 프롬프트 뒤에 덧붙이면
 * 그 나머지이고, 기본 프롬프트를 바꿨으면 바꾼 전체다. 바뀌지 않았으면 빈 문자열이다
 */
export function promptAddition(base: string, next: string): string {
  if (next === base) return "";
  if (next.startsWith(base)) return next.slice(base.length).trim();
  return next.trim();
}
