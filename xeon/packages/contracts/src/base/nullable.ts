import { Type, type TNull, type TSchema, type TUnion } from "typebox";

/** "명시적 비움"을 null로 표현하는 필수 필드용 스키마(DT-16). */
export function Nullable<T extends TSchema>(schema: T): TUnion<[T, TNull]> {
  return Type.Union([schema, Type.Null()]);
}
