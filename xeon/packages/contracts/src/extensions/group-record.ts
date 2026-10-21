import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TRecord,
  type TSchema,
  type TString,
  type TUnion,
  type TUnknown,
  type TUnsafe,
} from "typebox";
import { JsonValueSchema } from "../conversation/index.ts";
import { EXTENSION_KIND_PATTERN, type ExtensionEventKind } from "../records/index.ts";
import type { ExtensionName } from "./name.ts";

/** "grp.<groupId>.<영역>.<이름>" 또는 "x.<extensionName>.<영역>.<이름>". F.records.spec §3.2의 확장 kind와 같은 형식 */
export type RecordKind = ExtensionEventKind;
/** F.records.spec EXTENSION_KIND_PATTERN과 같은 값 */
export const RECORD_KIND_PATTERN: string = EXTENSION_KIND_PATTERN;
/** 끝의 ".*"는 접두 일치. 확장 단위("grp.learning.*")와 영역 단위("grp.learning.skill.*")를 허용한다 */
export const RECORD_KIND_READ_PATTERN: string =
  "^(x|grp)\\.[a-z][a-z0-9-]{1,31}\\.(\\*|[a-z][a-z0-9_]{0,31}\\.(\\*|[a-z][a-z_]*))$";

const RECORD_KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);
const RECORD_KIND_READ_REGEX = new RegExp(RECORD_KIND_READ_PATTERN);

export const RecordKindSchema: TUnsafe<RecordKind> = Type.Unsafe<RecordKind>(
  Type.String({ pattern: RECORD_KIND_PATTERN, minLength: 7, maxLength: 160 }),
);

/** kind가 group인 확장의 name */
export type GroupId = ExtensionName;

export const RecordSubjectSchema: TObject<{
  type: TUnion<
    [
      TLiteral<"thread">,
      TLiteral<"turn">,
      TLiteral<"step">,
      TLiteral<"item">,
      TLiteral<"task">,
      TLiteral<"external">,
    ]
  >;
  id: TString;
}> = Type.Object(
  {
    type: Type.Union([
      Type.Literal("thread"),
      Type.Literal("turn"),
      Type.Literal("step"),
      Type.Literal("item"),
      Type.Literal("task"),
      Type.Literal("external"),
    ]),
    id: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export type RecordSubject = Static<typeof RecordSubjectSchema>;

export const GroupRecordSchema: TObject<{
  groupId: TString;
  kind: typeof RecordKindSchema;
  version: TInteger;
  subject: typeof RecordSubjectSchema;
  payload: typeof JsonValueSchema;
}> = Type.Object(
  {
    groupId: Type.String({ pattern: "^[a-z][a-z0-9-]{1,31}$", maxLength: 32 }),
    kind: RecordKindSchema,
    /** payload 스키마 버전. 1부터 */
    version: Type.Integer({ minimum: 1 }),
    subject: RecordSubjectSchema,
    payload: JsonValueSchema,
  },
  { additionalProperties: false },
);
export type GroupRecord = Static<typeof GroupRecordSchema>;

/** 확장 레코드 종류 등록 */
export interface RecordKindDecl {
  readonly kind: RecordKind;
  readonly version: number;
  readonly description: string;
  readonly payload: TSchema;
}

/** 매니페스트 JSON에 싣는 형태. payload는 JSON Schema 객체 */
export const RecordKindDeclJsonSchema: TObject<{
  kind: typeof RecordKindSchema;
  version: TInteger;
  description: TString;
  payload: TRecord<"^.*$", TUnknown>;
}> = Type.Object(
  {
    kind: RecordKindSchema,
    version: Type.Integer({ minimum: 1 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

/** kind가 owner의 접두(그룹 grp.<name>., 플러그인 x.<name>.)에 속하는 올바른 레코드 kind인가 */
export function isRecordKindOf(
  kind: string,
  owner: { readonly kind: "group" | "plugin"; readonly name: string },
): boolean {
  const prefix = `${owner.kind === "group" ? "grp" : "x"}.${owner.name}.`;
  return kind.startsWith(prefix) && RECORD_KIND_REGEX.test(kind);
}

/** readsRecordKinds 항목 형식 검사(끝의 ".*" 허용) */
export function isRecordKindReadPattern(value: string): boolean {
  return RECORD_KIND_READ_REGEX.test(value);
}
