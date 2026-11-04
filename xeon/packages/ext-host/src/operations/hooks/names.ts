import type { HookSource } from "./config.ts";

// 외부 훅 단위의 이름(X.operations §4.7.4). 디스패치 계측(primitives/host.ts)과 정책이 쓴다. 실행기(runner.ts)는 primitives/host.ts의
// 타입을 가져오므로 실행기를 가져오면 순환이 생긴다. 그래서 이 이름들은 실행기와 떨어진 이 파일에 둔다.

const HOOK_UNIT_PREFIX = "fresnel-hooks-";

export function hookUnitName(source: HookSource): string {
  return `${HOOK_UNIT_PREFIX}${source}`;
}

export function isHookUnitName(name: string): boolean {
  return name.startsWith(HOOK_UNIT_PREFIX);
}
