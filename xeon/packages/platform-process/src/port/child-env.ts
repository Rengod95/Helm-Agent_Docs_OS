import { SENSITIVE_ENV_PATTERNS } from "@fresnel/contracts/services";

// L0.exec.spec §3.5의 `BASE_ENV_POLICY.pass`와 같은 허용 목록으로 자식 env를 만든다. MCP 서버(`mcp-spawn.ts`)와
// 플러그인 호스트 프로세스(`isolation-spawn.ts`)가 같이 쓴다. 부모의 나머지 env는 넘기지 않는다.

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

/**
 * 자식 env. 부모 env의 허용 목록 이름(거부 패턴 제외)을 옮기고, 이름이 없으면 `LANG`을 기본으로 채운 뒤 `plain`을 더한다.
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
