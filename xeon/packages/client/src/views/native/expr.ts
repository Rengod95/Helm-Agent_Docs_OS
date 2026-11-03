import { assertNever } from "@fresnel/contracts";
import type { UiCondition, UiScalar } from "@fresnel/contracts/extensions";
import type { PointerRead } from "./pointer.ts";
import { resolvePath, type Scope } from "./scope.ts";

// when 조건을 판정한다(ADR-0021 §3.4.1). 함수 호출과 스크립트는 없다.
// 경로가 없으면(found false) eq는 거짓, ne와 missing은 참, exists는 거짓이다.
// 그래서 `eq null`은 경로가 있고 값이 null일 때만 맞는다. 없는 경로는 null과 같지 않다.
// eq/ne는 === 비교다. 객체와 배열은 스칼라와 같지 않다. value를 빼면 undefined와 비교하므로 eq는 거짓이다.

export function evalCondition(condition: UiCondition, scope: Scope): boolean {
  const read = resolvePath(scope, condition.path);
  switch (condition.op) {
    case "exists":
      return exists(read);
    case "missing":
      return !exists(read);
    case "eq":
      return equalsScalar(read, condition.value);
    case "ne":
      return !equalsScalar(read, condition.value);
    default:
      return assertNever(condition.op, "evalCondition");
  }
}

function exists(read: PointerRead): boolean {
  return read.found && read.value !== null && read.value !== undefined;
}

function equalsScalar(read: PointerRead, expected: UiScalar | undefined): boolean {
  return read.found && read.value === expected;
}
