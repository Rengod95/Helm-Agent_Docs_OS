import { err, ok, type Result } from "./result.ts";

/** 던져진 값을 그대로 담은 오류. 호출자가 자기 오류 유니온으로 옮기거나 `cause`로 넘긴다. */
export type Thrown = { readonly kind: "threw"; readonly cause: unknown };

/** 문자열이 JSON이 아니다. */
export type JsonParseError = { readonly kind: "parse_json"; readonly cause: unknown };

/**
 * 던질 수 있는 호출 하나를 `Result`로 바꾼다(TY-25 변환). 받은 값은 `cause`에 담긴다.
 * 외부 API가 계약상 던지는 자리(파일, URL 해석, 프로세스 신호)에서 `try`를 직접 쓰지 않으려는 용도다.
 */
export function attempt<T>(fn: () => T): Result<T, Thrown> {
  try {
    return ok(fn());
  } catch (caught) {
    return err({ kind: "threw", cause: caught });
  }
}

/** `attempt`의 비동기 판. 거부된 값도 `cause`에 담는다. */
export async function attemptAsync<T>(fn: () => PromiseLike<T>): Promise<Result<T, Thrown>> {
  try {
    return ok(await fn());
  } catch (caught) {
    return err({ kind: "threw", cause: caught });
  }
}

/**
 * 기다리지 않는 비동기 호출의 거부를 `onFailure`로 넘긴다. 거부를 삼키지 않으려는 용도라 `onFailure`는
 * 기록, 알림, 상태 표시 중 하나를 해야 한다(TY-25). 빈 함수를 넘기지 않는다.
 */
export function detach(work: PromiseLike<unknown>, onFailure: (cause: unknown) => void): void {
  Promise.resolve(work).catch(onFailure);
}

/** 받은 값을 그대로 다시 던진다(TY-25 3). `Error`가 아닌 값은 `Error`로 감싸 `cause`에 담는다. `detach`의 `onFailure`로 쓴다. */
export function rethrow(cause: unknown): never {
  if (cause instanceof Error) throw cause;
  throw new Error("non-Error value was thrown", { cause });
}

/** JSON 문자열을 `unknown`으로 읽는다. 값은 쓰기 전에 `parse`로 검증한다(TY-10). */
export function parseJson(text: string): Result<unknown, JsonParseError> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch (caught) {
    return err({ kind: "parse_json", cause: caught });
  }
}
