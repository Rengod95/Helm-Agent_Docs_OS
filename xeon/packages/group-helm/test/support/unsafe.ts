import type { ServiceKey } from "@xeon/contracts/capabilities";

/** 시험의 부분 대역: 능력 서비스에서 쓰이지 않는 메서드와 브랜드 값을 생략한다. 키가 서비스의 타입을 정한다 */
export function fakeService<Api>(_key: ServiceKey<Api>, partial: object): Api {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 부분 대역: 쓰이지 않는 메서드를 생략한다 (eng.typescript.guide TY-06)
  return partial as Api;
}

/** 능력 조회 함수 대역: id로 서비스 객체를 찾고, 없으면 `absent`가 만든 오류를 던진다 */
export function capabilityLookup(
  table: ReadonlyMap<string, object>,
  absent: (id: string) => Error,
): <Api>(key: ServiceKey<Api>) => Api {
  return <Api>(key: ServiceKey<Api>): Api => {
    const service = table.get(key.capability);
    if (service === undefined) throw absent(key.capability);
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 부분 대역: 키의 서비스 타입을 시험 객체에 붙인다 (eng.typescript.guide TY-06)
    return service as Api;
  };
}
