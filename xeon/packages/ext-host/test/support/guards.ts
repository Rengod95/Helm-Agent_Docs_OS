// 시험용 좁히기 도우미: unknown 값을 단언 없이 읽는다.

export function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) throw new TypeError("record expected");
  return Object.fromEntries(Object.entries(value));
}

export function textOf(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("string expected");
  return value;
}

export function optionalTextOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
