import { SENSITIVE_ENV_PATTERNS } from "@xeon/contracts/services";

// L0.secrets.spec §4.5. 자식 env 거부 목록의 정본은 F 상수 SENSITIVE_ENV_PATTERNS 하나다.
// 이 패키지는 별도 목록을 두지 않는다. sops를 부를 때 쓰는 env는 부모 env에서 이 상수에 맞는 이름을
// 모두 지운 것에 키 획득 변수 하나만 더한 것이다.

const KEY_ENV_NAMES: readonly string[] = ["SOPS_AGE_KEY_CMD", "SOPS_AGE_KEY_FILE"];

/** 끝의 *만 와일드카드, 앞의 *는 접미 일치다(L0.exec.spec §3.5). 대소문자를 구분하지 않아 더 많이 지운다 */
export function isSensitiveEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return SENSITIVE_ENV_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) return upper.endsWith(pattern.slice(1));
    if (pattern.endsWith("*")) return upper.startsWith(pattern.slice(0, -1));
    return upper === pattern;
  });
}

/** 값이 없는(undefined) 항목은 건너뛴다. 입력을 바꾸지 않는다 */
export function filterSensitiveEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (isSensitiveEnvName(name)) continue;
    out[name] = value;
  }
  return out;
}

export type KeyEnv = Readonly<Record<string, string>>;

/**
 * sops 호출 env. 거른 부모 env + 키 변수 하나(SOPS_AGE_KEY_CMD 또는 SOPS_AGE_KEY_FILE).
 * 키 변수 외의 이름이 오면 무시한다(sops 자식에 다른 비밀 변수가 끼지 않게 한다).
 */
export function buildSopsEnv(
  parent: Readonly<Record<string, string | undefined>>,
  keyEnv: KeyEnv,
): Record<string, string> {
  const out = filterSensitiveEnv(parent);
  let added = false;
  for (const name of KEY_ENV_NAMES) {
    const value = keyEnv[name];
    if (value !== undefined && !added) {
      out[name] = value;
      added = true;
    }
  }
  return out;
}

/** 키 변수 없이 거른 env. `sops --version`처럼 복호화가 없는 호출에 쓴다 */
export function buildPlainEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return filterSensitiveEnv(parent);
}
