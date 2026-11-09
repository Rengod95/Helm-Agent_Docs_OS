// shim 안의 작은 도구. 번들에 `@fresnel/contracts`(pi-ai까지 딸려 온다)를 끌지 않으려고 필요한 것만 여기 둔다.

/** 던질 수 있는 호출의 결과. 던진 값은 `cause`에 그대로 담는다(삼키지 않는다) */
export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly cause: unknown };

export function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

export async function attemptAsync<T>(fn: () => PromiseLike<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

/**
 * 셸 명령의 거절 값. Error가 아니라 문자열 코드나 `{kind}`를 그대로 준다(preload와 같다).
 * 값의 모양을 좁히지 않으려고 `unknown`으로 받는다.
 */
export function refuse(reason: unknown): Promise<never> {
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸 거절 값은 문자열 코드나 {kind}다. Error로 감싸지 않는다(preload와 같다)
  return Promise.reject(reason);
}

/** 기다리지 않는 호출의 거절을 `onFailure`로 넘긴다(`@fresnel/contracts`의 `detach`와 같다). 번들에 계약 패키지를 끌지 않으려고 여기 둔다 */
export function detach(work: PromiseLike<unknown>, onFailure: (cause: unknown) => void): void {
  Promise.resolve(work).catch(onFailure);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 객체의 자기 속성 값. 객체가 아니거나 속성이 없으면 `undefined` */
export function ownField(value: unknown, key: string): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
  return value[key];
}
