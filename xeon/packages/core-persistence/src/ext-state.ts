// 확장 상태 문서 이벤트 `<x|grp>.<이름>.state.committed`의 payload(X.primitives.spec §4.6.1).
// 이 kind는 X가 정하고 쓴다. 저장소는 활성 가지 위 마지막 판을 찾는 데(expectStateRev, loadThread) 필요한 필드만 안다.
import { Nullable } from "@xeon/contracts";
import { EventIdSchema, type EventId } from "@xeon/contracts/conversation";
import {
  Type,
  type TInteger,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnknown,
  type TUnsafe,
} from "typebox";

export const EXT_STATE_KIND_SUFFIX: string = ".state.committed";

export const ExtStatePayloadSchema: TObject<{
  scopeId: TString;
  rev: TInteger;
  prevEventId: TUnion<[TUnsafe<EventId>, TNull]>;
  version: TInteger;
  doc: TUnknown;
}> = Type.Object(
  {
    scopeId: Type.String({ minLength: 1, maxLength: 96 }),
    /** 활성 가지 안의 판 번호. 1부터 */
    rev: Type.Integer({ minimum: 1 }),
    prevEventId: Nullable(EventIdSchema),
    /** 저장 당시 StateDecl.version */
    version: Type.Integer({ minimum: 1 }),
    /** JSON 값. 모양은 StateDecl.schema가 정하고 X가 커밋 전에 검사했다 */
    doc: Type.Unknown(),
  },
  { additionalProperties: false },
);
