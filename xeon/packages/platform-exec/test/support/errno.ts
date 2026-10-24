/** 던져진 값에서 errno 코드(EBUSY 등)를 읽는다. 코드가 없으면 undefined */
export function errnoCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}
