import {
  Type,
  type TObject,
  type TProperties,
  type TSchema,
  type TString,
  type TUnsafe,
} from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { WireMetaSchema, type WireMeta } from "./jsonrpc.ts";

// M4 wire 확장(W-15 ~ W-50)이 스키마를 짧게 쓰려는 도구다. 인터페이스를 정본으로 두고 스키마가 그것을 증명한다(SchemaProof).

/** 브랜드 없는 멱등 키(1~64자). `turn.start`의 requestId와 `turn.withdraw`의 requestId가 같은 스키마다(F.conversation.spec §3.5) */
export const RequestKeySchema: TString = Type.String({ minLength: 1, maxLength: 64 });

/** 요청 params. 레지스트리가 모든 요청에 더하는 `_meta`(F.wire-settings.spec §3.6)를 포함한다 */
export type Req<T> = T & { readonly _meta?: WireMeta };

/** 닫힌 객체(`additionalProperties: false`) */
export function closed<P extends TProperties>(properties: P): TObject<P> {
  return Type.Object(properties, { additionalProperties: false });
}

/** 요청 params용 닫힌 객체. `_meta`를 더한다 */
export function request<P extends TProperties>(
  properties: P,
): TObject<P & { _meta: ReturnType<typeof optionalMeta> }> {
  return Type.Object({ ...properties, _meta: optionalMeta() }, { additionalProperties: false });
}

function optionalMeta(): ReturnType<typeof Type.Optional<typeof WireMetaSchema>> {
  return Type.Optional(WireMetaSchema);
}

/** 인자가 없는 요청 params. `_meta`만 받는다 */
export interface NoParams {
  readonly _meta?: WireMeta;
}
const NoParamsShape = request({});
export const NoParamsSchema: TUnsafe<NoParams> = Type.Unsafe<NoParams>(
  NoParamsShape satisfies SchemaProof<NoParams, typeof NoParamsShape>,
);

/** M4 메서드의 레지스트리 항목. `WireMethodSpec`(methods.ts)과 같은 모양이다 */
export interface M4Spec<P extends TSchema, R extends TSchema> {
  readonly params: P;
  readonly result: R;
  readonly since: "0.1.0";
  readonly status: "active";
  readonly stage: "M4";
}
export function m4<P extends TSchema, R extends TSchema>(params: P, result: R): M4Spec<P, R> {
  return { params, result, since: "0.1.0", status: "active", stage: "M4" };
}

/** 메서드 하나의 params·result 스키마 쌍(`WireSchemas` 항목 모양) */
export interface Io<P extends TSchema, R extends TSchema> {
  params: P;
  result: R;
}
