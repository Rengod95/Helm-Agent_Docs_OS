import type { ServiceKey } from "@fresnel/contracts/capabilities";

/** 시험의 부분 대역: 기능 서비스에서 쓰이지 않는 메서드를 생략한다. 키가 서비스의 타입을 정한다 */
export function fakeService<Api>(_key: ServiceKey<Api>, partial: object): Api {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 부분 대역: 쓰이지 않는 메서드를 생략한다 (eng.typescript.guide TY-06)
  return partial as Api;
}
