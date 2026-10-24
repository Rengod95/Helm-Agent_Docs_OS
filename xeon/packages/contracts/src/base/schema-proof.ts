import type { Static, TSchema } from "typebox";

// eng.typescript.guide TY-26. `Type.Unsafe<T>(schema)`는 컴파일러가 모르는 사이 정적 타입 T를 스키마에 붙인다.
// 스키마가 T보다 느슨하면 parse를 통과한 값이 T가 아닐 수 있다. 아래 두 타입은 그 간격을 컴파일 시점에 막는다.
// 값 import가 없는 타입이라 services처럼 다른 F 디렉터리에서 타입만 가져와야 하는 곳도 쓴다.
//
//   const shape = Type.Object({ ... });
//   export const FooSchema: TUnsafe<Foo> = Type.Unsafe<Foo>(shape satisfies SchemaProof<Foo, typeof shape>);
//
// 증명하지 못하면 `satisfies never` 오류가 난다. 원인은 둘 중 하나다.
//   1. 스키마의 정적 타입 Static<S>가 T에 대입되지 않는다: 스키마가 T에 없는 값(예: unknown, string)을 받는다.
//   2. T의 최상위 키가 스키마에 없다: T의 선택 필드를 스키마가 검사하지 않는다.

/** 객체 T용. Static<S>가 T에 대입되고 T의 모든 최상위 키(선택 필드 포함)를 스키마가 가진다 */
export type SchemaProof<T, S extends TSchema> = [Static<S>] extends [T]
  ? [keyof T] extends [keyof Static<S>]
    ? TSchema
    : never
  : never;

/** 객체가 아닌 T용(유니온, 배열). Static<S>가 T에 대입되는 것만 확인한다 */
export type SchemaSound<T, S extends TSchema> = [Static<S>] extends [T] ? TSchema : never;
