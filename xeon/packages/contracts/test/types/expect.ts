/** 컴파일 시점 타입 검사 도우미. tsc -b가 test/ 도 검사하므로 불일치는 typecheck에서 실패한다. */
/* oxlint-disable typescript/no-unnecessary-type-parameters -- Equal의 표준 구현은 T를 한 번만 쓴다 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* oxlint-enable typescript/no-unnecessary-type-parameters */
export type Expect<T extends true> = T;
/** A가 B에 대입 가능한가 */
export type Assignable<A, B> = [A] extends [B] ? true : false;
/** readonly 수정자와 readonly 배열을 벗긴 타입. TypeBox Static(가변)과 손으로 쓴 읽기 전용 인터페이스를 견줄 때 쓴다. 원시 값과 브랜드 문자열은 그대로 둔다 */
export type DeepMutable<T> = T extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;
