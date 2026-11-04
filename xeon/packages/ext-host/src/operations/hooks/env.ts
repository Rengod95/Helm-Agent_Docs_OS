import type { HookDef, HookHookName } from "./config.ts";

// 자식 프로세스 환경 정리(X.operations.spec §4.7.5)

export const BASE_ENV_ALLOW: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TERM",
  "SHELL",
];

/** 이름에 이 단어가 있으면 허용 목록에 있어도 넘기지 않는다 */
export const SECRET_ENV_PATTERN: RegExp = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

export interface HookEnvInjected {
  readonly hookId: string;
  readonly point: HookHookName;
  readonly threadId: string;
  readonly projectDir: string;
}

/** 순수 함수. 환경을 비우고 허용된 이름만 넣는다. 시크릿 참조(`secret://`)는 풀지 않는다 */
export function hookEnv(
  parent: Readonly<Record<string, string | undefined>>,
  def: HookDef,
  extraAllow: readonly string[],
  injected: HookEnvInjected,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const take = (name: string): void => {
    if (SECRET_ENV_PATTERN.test(name)) return;
    const value = parent[name];
    if (value !== undefined) out[name] = value;
  };
  for (const name of BASE_ENV_ALLOW) take(name);
  for (const name of def.env ?? []) if (extraAllow.includes(name)) take(name);
  out["FRESNEL_HOOK_ID"] = injected.hookId;
  out["FRESNEL_HOOK_HOOK"] = injected.point;
  out["FRESNEL_THREAD_ID"] = injected.threadId;
  out["FRESNEL_PROJECT_DIR"] = injected.projectDir;
  return out;
}
