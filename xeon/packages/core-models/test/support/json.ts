function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** unknown 값에서 경로를 따라 읽는다. 없으면 undefined. 시험이 페이로드 모양을 단언 없이 확인하는 데 쓴다 */
export function at(value: unknown, ...path: readonly (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}
