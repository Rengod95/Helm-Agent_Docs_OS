import { HOOK_UNIT_NAME_PREFIX } from "@fresnel/contracts/extensions";
import { HOOK_SOURCES, type HookSource } from "./config.ts";

// 외부 훅 단위의 이름(X.operations §4.7.4). 디스패치 계측(primitives/host.ts)과 정책이 쓴다. 실행기(runner.ts)는 primitives/host.ts의
// 타입을 가져오므로 실행기를 가져오면 순환이 생긴다. 그래서 이 이름들은 실행기와 떨어진 이 파일에 둔다.
// 접두(`HOOK_UNIT_NAME_PREFIX`)는 외부 확장이 쓸 수 없다(F.extensions §4.7). 그래도 판정은 접두가 아니라 네 이름과 정확히 맞춘다.

export function hookUnitName(source: HookSource): string {
  return `${HOOK_UNIT_NAME_PREFIX}${source}`;
}

const HOOK_UNIT_NAMES: ReadonlySet<string> = new Set(
  HOOK_SOURCES.map((source) => hookUnitName(source)),
);

export function isHookUnitName(name: string): boolean {
  return HOOK_UNIT_NAMES.has(name);
}
