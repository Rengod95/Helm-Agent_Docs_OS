import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { parse } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import { FileChangeSchema, type FileChange } from "./defs/workspace.ts";

// 변경 기록 공통 결과 형식(M5e 스펙 §4.7, R22). 도구 결과 `details`의 예약 키 `fileChanges`에 싣는다.
// `FileChangeSchema`(쓰기·편집 결과)는 그대로 두고, 그 위에 여러 파일과 출처를 더하는 형식이다.

/** 내용 참조. 되감기가 쓴다. sha256은 내용의 해시, size는 바이트 수다 */
const ContentRefSchema: TObject<{ sha256: TString; size: TInteger }> = Type.Object(
  { sha256: Type.String(), size: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const FileChangeEntrySchema: TObject<{
  path: TString;
  op: TUnion<[TLiteral<"create">, TLiteral<"modify">, TLiteral<"delete">, TLiteral<"rename">]>;
  from: TOptional<TString>;
  existed: TBoolean;
  diff: TOptional<TString>;
  added: TInteger;
  removed: TInteger;
  firstChangedLine: TOptional<TInteger>;
  before: TOptional<typeof ContentRefSchema>;
  after: TOptional<typeof ContentRefSchema>;
  source: TUnion<[TLiteral<"observed">, TLiteral<"reported">]>;
}> = Type.Object(
  {
    /** 정규 경로 */
    path: Type.String({ maxLength: 4096 }),
    op: Type.Union([
      Type.Literal("create"),
      Type.Literal("modify"),
      Type.Literal("delete"),
      Type.Literal("rename"),
    ]),
    /** rename의 옛 경로 */
    from: Type.Optional(Type.String({ maxLength: 4096 })),
    /** 지금 `FileChange.existed`와 같다 */
    existed: Type.Boolean(),
    /** unified diff. 이진 파일이나 큰 파일은 생략한다 */
    diff: Type.Optional(Type.String()),
    added: Type.Integer({ minimum: 0 }),
    removed: Type.Integer({ minimum: 0 }),
    firstChangedLine: Type.Optional(Type.Integer({ minimum: 1 })),
    before: Type.Optional(ContentRefSchema),
    after: Type.Optional(ContentRefSchema),
    /** `observed`는 코어 파일 서비스가 본 변경, `reported`는 플러그인이 알린 변경(검증되지 않음) */
    source: Type.Union([Type.Literal("observed"), Type.Literal("reported")]),
  },
  { additionalProperties: false },
);
export type FileChangeEntry = Static<typeof FileChangeEntrySchema>;

/** 도구 결과 `details`의 예약 키. `details = { …도구가 낸 값, fileChanges?: FileChangeEntry[] }` */
export const FILE_CHANGES_KEY = "fileChanges" as const;

const KeyedDetailsSchema: TObject<{ fileChanges: TArray<typeof FileChangeEntrySchema> }> =
  Type.Object({ fileChanges: Type.Array(FileChangeEntrySchema) });

/** 옛 `FileChange` 한 건을 항목 하나로 읽는다. 옛 형식에는 `op`이 없어 `existed`로 정한다 */
function entryOfLegacy(change: FileChange): FileChangeEntry {
  return {
    path: change.path,
    op: change.existed ? "modify" : "create",
    existed: change.existed,
    diff: change.diff,
    added: change.added,
    removed: change.removed,
    ...(change.firstChangedLine === undefined ? {} : { firstChangedLine: change.firstChangedLine }),
    source: "observed",
  };
}

/**
 * 도구 결과 `details`에서 변경 항목을 읽는다(순수 함수). 새 형식(`fileChanges` 키)을 먼저 보고,
 * 없으면 옛 `FileChange` 한 건을 `observed` 항목 하나로 읽는다. 키가 있는데 모양이 틀리거나 둘 다 아니면 빈 목록이다.
 */
export function fileChangesOf(details: JsonValue | null): readonly FileChangeEntry[] {
  if (details === null) return [];
  const keyed = parse(KeyedDetailsSchema, details);
  if (keyed.ok) return keyed.value.fileChanges;
  const legacy = parse(FileChangeSchema, details);
  if (!legacy.ok) return [];
  const entry: FileChangeEntry = entryOfLegacy(legacy.value);
  const entries: FileChangeEntry[] = [];
  entries.push(entry);
  return entries;
}
