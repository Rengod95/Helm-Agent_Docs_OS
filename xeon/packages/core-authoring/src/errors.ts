import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";

// 파일 작업 하나를 `DevkitError` 값으로 바꾼다. 던진 값은 메시지와 없음 여부만 남긴다(TY-25).

function codeOf(caught: unknown): string | undefined {
  if (typeof caught !== "object" || caught === null || !("code" in caught)) return undefined;
  return typeof caught.code === "string" ? caught.code : undefined;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export async function io<T>(
  label: string,
  work: () => PromiseLike<T>,
): Promise<Result<T, DevkitError>> {
  const attempted = await attemptAsync(work);
  if (attempted.ok) return ok(attempted.value);
  const cause = attempted.error.cause;
  const message = `${label}: ${messageOf(cause)}`;
  return err({ kind: codeOf(cause) === "ENOENT" ? "not_found" : "io", message });
}

export function invalid(message: string): DevkitError {
  return { kind: "invalid_input", message };
}

/** 항목마다 비동기 작업을 함께 돌리고 첫 실패를 돌려준다(항목은 서로 독립이다) */
export async function mapAll<I, T>(
  items: readonly I[],
  work: (item: I) => Promise<Result<T, DevkitError>>,
): Promise<Result<T[], DevkitError>> {
  const results = await Promise.all(items.map((item) => work(item)));
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** 배열이면 그 항목(unknown)을, 아니면 빈 배열을 돌려준다 */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((item: unknown) => item) : [];
}
