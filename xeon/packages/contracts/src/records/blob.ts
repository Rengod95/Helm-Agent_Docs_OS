import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";

export const BlobRefSchema: TObject<{
  type: TLiteral<"blob">;
  sha256: TString;
  size: TInteger;
  mediaType: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    type: Type.Literal("blob"),
    /** 소문자 hex 64자 */
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 }),
    /** 바이트, 정수 ≥ 0 */
    size: Type.Integer({ minimum: 0 }),
    mediaType: Type.Union([Type.String({ minLength: 1, maxLength: 127 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type BlobRef = Static<typeof BlobRefSchema>;

/** envelope payload 안에서 blob으로 옮긴 문자열 필드. 그 위치의 값은 "blob:sha256:<hex>" 자리표시 문자열이다. */
export const DetachedFieldSchema: TObject<{
  pointer: TString;
  ref: typeof BlobRefSchema;
}> = Type.Object(
  {
    /** RFC 6901 JSON Pointer, payload 기준. 빈 문자열이거나 "/"로 시작한다 */
    pointer: Type.String({ pattern: "^(?:|/.*)$", maxLength: 1024 }),
    ref: BlobRefSchema,
  },
  { additionalProperties: false },
);
export type DetachedField = Static<typeof DetachedFieldSchema>;

export const BLOB_PLACEHOLDER_PREFIX: string = "blob:sha256:";
