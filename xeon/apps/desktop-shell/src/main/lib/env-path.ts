// 엔진과 `fresnel secret` 자식의 환경(env_path.rs, L4.desktop.spec E7). PATH 보강 규칙은 ../env-path.ts의 augmentPath다.
import { augmentPath } from "../env-path.ts";

/**
 * 엔진과 `fresnel secret` 자식이 쓰는 환경(E7). `BUN_OPTIONS`만 지우고 나머지는 상속한다.
 * PATH는 보강하고, 없으면 새로 만든다. `home`은 사용자 홈 디렉터리(E6의 작업 폴더와 같다).
 */
export function engineEnv(
  vars: NodeJS.ProcessEnv,
  home: string | null,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && key !== "BUN_OPTIONS") env[key] = value;
  }
  env["PATH"] = augmentPath(env["PATH"], home, platform);
  return env;
}
