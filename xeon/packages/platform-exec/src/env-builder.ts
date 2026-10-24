import { err, ok, type Result } from "@xeon/contracts";
import { SENSITIVE_ENV_PATTERNS } from "@xeon/contracts/services";

// L0.exec.spec §3.5. 자식 프로세스 env는 부모 env 전체가 아니라 이름 허용 목록으로 만든다.

export interface EnvPolicy {
  /** 부모 env에서 값을 그대로 옮기는 이름 */
  readonly pass: readonly string[];
  /** 부모 값과 무관하게 고정하는 값 */
  readonly fixed: Readonly<Record<string, string>>;
  /** 어떤 경로로도 자식에 넣지 않는 이름 패턴. `*`는 임의 문자열이다 */
  readonly deny: readonly string[];
}

export const BASE_ENV_POLICY: EnvPolicy = {
  pass: ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "SHELL"],
  fixed: { TERM: "dumb", NO_COLOR: "1", CI: "1" },
  deny: SENSITIVE_ENV_PATTERNS,
};

/** 결과에 `LANG`이 없을 때 넣는 값 */
const DEFAULT_LANG = "C.UTF-8";

/** 자식 env에 넣을 수 있는 이름. `=`나 공백이 든 이름은 spawn 인자를 깨뜨린다 */
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return VALID_ENV_NAME.test(name);
}

export type EnvBuildError = { readonly kind: "env_denied"; readonly names: readonly string[] };

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 거부 패턴 하나를 정규식으로 바꾼다. `*`만 와일드카드다.
 * 환경 변수 이름 대소문자가 OS마다 다르므로 대소문자를 가리지 않고 맞춘다(더 많이 거부하는 쪽).
 */
function denyRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i");
}

/** 이름이 거부 패턴에 하나라도 맞는가 */
export function isDeniedEnvName(name: string, deny: readonly string[]): boolean {
  return deny.some((pattern) => denyRegExp(pattern).test(name));
}

/**
 * 순수 함수. 부모 env, 정책, 설정 추가분, 호출자 요청에서 자식 env를 만든다.
 * 결과 = (inherit이면 pass ∪ extraPass 이름의 부모 값) ⊕ fixed ⊕ requested. 뒤가 앞을 덮는다.
 * deny에 맞는 이름은 pass·extraPass에 있어도 옮기지 않고, requested에 있으면 `env_denied`다.
 */
export function buildChildEnv(input: {
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly policy: EnvPolicy;
  /** l0.exec.envAllowlist.extra + provider.envAllowlistExtra */
  readonly extraPass: readonly string[];
  /** ShellExecOptions.env */
  readonly requested: Readonly<Record<string, string>> | undefined;
  /** ShellExecOptions.inheritEnv ?? true */
  readonly inherit: boolean;
}): Result<Record<string, string>, EnvBuildError> {
  const { parent, policy, extraPass, requested, inherit } = input;

  const denied = Object.keys(requested ?? {}).filter(
    (name) => !isValidEnvName(name) || isDeniedEnvName(name, policy.deny),
  );
  if (denied.length > 0) return err({ kind: "env_denied", names: denied });

  const result: Record<string, string> = {};
  if (inherit) {
    for (const name of [...policy.pass, ...extraPass]) {
      if (isDeniedEnvName(name, policy.deny)) continue;
      const value = parent[name];
      if (value !== undefined) result[name] = value;
    }
  }
  Object.assign(result, policy.fixed);
  if (!("LANG" in result)) result["LANG"] = DEFAULT_LANG;
  Object.assign(result, requested);
  return ok(result);
}
