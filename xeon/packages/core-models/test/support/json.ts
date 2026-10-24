/** unknown 값에서 경로를 따라 읽는다. 없으면 undefined. 시험이 페이로드 모양을 단언 없이 확인하는 데 쓴다 */
export function at(value: unknown, ...path: readonly (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}
