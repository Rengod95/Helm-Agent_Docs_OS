// 시험의 타입 어김 주입기(eng.typescript.guide TY-06 A6). 시험 본문에는 단언을 쓰지 않고 이 함수를 거친다.

/** 필요한 메서드만 가진 가짜를 전체 API 타입으로 내보낸다. 시험이 쓰지 않는 메서드는 호출하면 던진다 */
export function partial<T extends object>(methods: Partial<T>): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 부분 대역: 시험이 부르는 메서드만 채운다 (eng.typescript.guide TY-06)
  return methods as T;
}

/** 같은 메서드를 가진 대체 객체를 원래 API 타입으로 내보낸다. 계측 래퍼가 쓴다 */
export function widen<T extends object>(original: T, replacement: Record<string, unknown>): T {
  return { ...original, ...replacement };
}
