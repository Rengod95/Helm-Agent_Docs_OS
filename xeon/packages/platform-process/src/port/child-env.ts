import { SENSITIVE_ENV_PATTERNS } from "@fresnel/contracts/services";

// 자식 env를 만드는 두 길이다. 열린 길(`openChildEnv`, MCP 서버와 플러그인 격리·훑기·스크립트의 기본)은 부모 env에서
// `FRESNEL_` 이름만 뺀다. 좁은 길(`childEnv`, 승인 전 드래프트의 `narrow` 호출)은 L0.exec.spec §3.5의 허용 목록만 옮긴다.
// [결정: 2026-11-21, 사용자, AGE-63]

/** 자식에게 옮기는 부모 env 이름(L0.exec.spec §3.5 `BASE_ENV_POLICY.pass`와 같은 목록) */
const INHERITED_ENV: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "SHELL",
];

/** 환경 변수 이름 형식. 이 형식이 아니면 `env_denied`다 */
export const VALID_ENV_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_LANG = "C.UTF-8";

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** 시크릿 이름 패턴(`SENSITIVE_ENV_PATTERNS`, 끝과 앞의 `*`만 와일드카드)에 든 이름인가 */
function isDeniedEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) =>
    new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i").test(name),
  );
}

/** Fresnel 내부 값의 이름 머리. 열린 길의 자식 env에서 이 머리로 시작하는 부모 이름은 모두 뺀다 */
const FRESNEL_INTERNAL_PREFIX = "FRESNEL_";

/**
 * 좁은 길의 자식 env. 부모 env의 허용 목록 이름(거부 패턴 제외)을 옮기고, 이름이 없으면 `LANG`을 기본으로 채운 뒤 `plain`을 더한다.
 * `plain`은 정의(호출자)가 이름과 값을 정한 것이라 거부 패턴을 거치지 않는다.
 */
export function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  plain: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    if (isDeniedEnvName(name)) continue;
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (!("LANG" in env)) env["LANG"] = DEFAULT_LANG;
  return Object.assign(env, plain);
}

/**
 * 열린 길의 자식 env. 부모 env의 이름을 모두 옮기되 `FRESNEL_`로 시작하는 것만 뺀다. 토큰과 키 이름 패턴도 거르지 않는다
 * (사용자 환경 그대로, 셸 도구의 열린 정책과 같은 결정 [결정: 2026-11-21, 사용자, AGE-63]). `plain`은 호출자가 준 값을 그대로 더한다.
 * `FRESNEL_` 이름은 `plain`에 있어도 빼지 않는다: 호출자가 만든 값이고, 이 함수는 부모 env에서만 거른다.
 */
export function openChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  plain: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || name.startsWith(FRESNEL_INTERNAL_PREFIX)) continue;
    env[name] = value;
  }
  return Object.assign(env, plain);
}
