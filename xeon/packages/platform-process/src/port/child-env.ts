import { BASE_ENV_PASS_NAMES } from "@fresnel/contracts/services";

// 자식 env를 만드는 한 길이다. 플러그인 격리 프로세스, 가져오기 훑기, 플러그인 스크립트, MCP 서버가 모두 셸 도구와 같은 허용 목록
// (`BASE_ENV_PASS_NAMES`, L0.exec.spec §3.5)의 이름만 부모 env에서 옮긴다. 토큰·키가 든 변수와 `FRESNEL_` 내부 값은 목록에 없어 넘어가지 않는다.
// [결정: 2026-11-22, 사용자, AGE-63; 이전의 "열린 길은 부모 env 전부(FRESNEL_ 제외)"는 이 결정으로 대체되었다]

/** 환경 변수 이름 형식. 이 형식이 아니면 `env_denied`다 */
export const VALID_ENV_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_LANG = "C.UTF-8";

/**
 * 자식 env. 부모 env의 허용 목록 이름만 옮기고, `LANG`이 없으면 기본을 채운 뒤 `plain`을 더한다.
 * `plain`은 호출자(스크립트 선언, MCP 서버 설정에 사용자가 적은 `env`)가 이름과 값을 정한 것이라 그대로 넘긴다.
 */
export function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  plain: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV_PASS_NAMES) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (!("LANG" in env)) env["LANG"] = DEFAULT_LANG;
  return Object.assign(env, plain);
}
