// 알 수 없는 값(IPC 인자, JSON, 오류)을 좁히는 작은 도구. `as` 없이 타입을 얻는다.

/** 배열이 아닌 객체. JSON 객체와 IPC 인자 객체가 이 모양이다 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 정수인 수(`2.0`은 JS에서 `2`와 같다) */
export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** 객체가 자기 속성으로 가진 값. 없으면 undefined다. 상속 속성은 보지 않는다 */
export function ownField(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Object.getOwnPropertyDescriptor(value, name)?.value;
  return field;
}

/** Node 파일 오류의 코드(`ENOENT`, `EACCES` 같은 것). 코드가 없는 값이면 null */
export function errnoCode(cause: unknown): string | null {
  const code = ownField(cause, "code");
  return typeof code === "string" ? code : null;
}
