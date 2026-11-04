import { HOOK_UNIT_NAME_PREFIX } from "@fresnel/contracts/extensions";

// 외부 훅 단위의 이름(X.operations §4.7.4). 훅 하나가 단위 하나다: 이름은 예약 접두 뒤에 훅 id를 붙인 값이고 Registration id와 같다.
// 디스패치 계측(primitives/host.ts)과 정책이 이 판정을 쓴다. 실행기(runner.ts)는 primitives/host.ts의 타입을 가져오므로
// 실행기를 가져오면 순환이 생긴다. 그래서 이 이름들은 실행기와 떨어진 이 파일에 둔다.
// 접두(`HOOK_UNIT_NAME_PREFIX`)는 외부 확장이 쓸 수 없다(F.extensions §4.7). 그래서 접두만으로 판정해도 외부 확장과 겹치지 않는다.

/** 훅 id의 단위 이름이자 Registration id */
export function hookUnitName(hookId: string): string {
  return `${HOOK_UNIT_NAME_PREFIX}${hookId}`;
}

export function isHookUnitName(name: string): boolean {
  return name.startsWith(HOOK_UNIT_NAME_PREFIX);
}

/** 단위 이름에서 훅 id를 꺼낸다. 외부 훅 단위가 아니면 undefined */
export function hookIdOfUnit(name: string): string | undefined {
  return isHookUnitName(name) ? name.slice(HOOK_UNIT_NAME_PREFIX.length) : undefined;
}
