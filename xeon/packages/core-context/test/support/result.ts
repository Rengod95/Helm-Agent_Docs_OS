import { Bug, type Result } from "@xeon/contracts";

/** 시험 전용: 성공 값을 꺼낸다. 실패면 그 자리에서 시험을 실패시킨다 */
export function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Bug(`test.unexpected_error: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** 시험 전용: undefined가 아님을 확인하고 값을 돌려준다 */
export function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Bug("test.unexpected_undefined");
  return value;
}

/** 시험 전용: 타입을 어긴 값을 흉내 낸다. 핸들러 결과 스키마 검사가 막는지 확인할 때만 쓴다 */
export function unsafeResult(value: unknown): never {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 시험 전용: 결과 스키마를 어긴 반환값을 흉내 낸다 (eng.testing.guide TS-04)
  return value as never;
}
