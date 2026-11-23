import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNumber,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";
import { parse } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";

// 그려 볼 수 있는 파일과 셸 산출물 목록(F.capabilities.spec §3.14, AGE-77 S-08). 아티팩트 판(desktop artifact-model)이 확장자로
// 종류를 정하고, 셸(bash)이 실행 전후로 작업 폴더를 견줘 새로 생기거나 바뀐 파일을 `details`의 예약 키 `artifactFiles`에 싣는다.
// 확장자 목록은 이 파일 하나가 단일 출처다.

/** 아티팩트 판이 그릴 수 있는 종류. 등록 아티팩트의 media type 종류와 같은 말이다 */
export type ViewableArtifactKind = "html" | "svg" | "image" | "markdown";

/** 확장자(소문자, 점 없이)와 종류. 목록에 없는 확장자는 판이 다루지 않는다 */
export const VIEWABLE_EXTENSION_KINDS: ReadonlyMap<string, ViewableArtifactKind> = new Map<
  string,
  ViewableArtifactKind
>([
  ["html", "html"],
  ["htm", "html"],
  ["svg", "svg"],
  ["png", "image"],
  ["jpg", "image"],
  ["jpeg", "image"],
  ["gif", "image"],
  ["webp", "image"],
  ["md", "markdown"],
  ["markdown", "markdown"],
]);

/** 경로의 확장자로 보는 종류. 대소문자를 가리지 않는다. 확장자가 없거나 목록에 없으면 null. 맨 앞의 점은 숨김 이름이지 확장자가 아니다 */
export function viewableKindOfPath(path: string): ViewableArtifactKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return VIEWABLE_EXTENSION_KINDS.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** 도구 결과 `details`의 예약 키. `details = { …도구가 낸 값, artifactFiles?: ArtifactFileEntry[] }` */
export const ARTIFACT_FILES_KEY = "artifactFiles" as const;

/** 한 번의 셸 호출이 싣는 산출물 파일 수 상한. 넘는 것은 경로순으로 뒤를 뺀다 */
export const MAX_ARTIFACT_FILES = 32;

/** 셸 호출 전후로 견준 한 파일. `create`는 호출 전에 없었고 `modify`는 크기나 수정 시각이 바뀌었다 */
export const ArtifactFileEntrySchema: TObject<{
  path: TString;
  op: TUnion<[TLiteral<"create">, TLiteral<"modify">]>;
  size: TInteger;
  mtimeMs: TNumber;
}> = Type.Object(
  {
    /** 절대 경로(작업 폴더 안의 파일). 아티팩트 판이 작업 폴더 기준으로 바꾼다 */
    path: Type.String({ maxLength: 4096 }),
    op: Type.Union([Type.Literal("create"), Type.Literal("modify")]),
    size: Type.Integer({ minimum: 0 }),
    mtimeMs: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ArtifactFileEntry = Static<typeof ArtifactFileEntrySchema>;

const KeyedDetailsSchema: TObject<{ artifactFiles: TArray<typeof ArtifactFileEntrySchema> }> =
  Type.Object({
    artifactFiles: Type.Array(ArtifactFileEntrySchema, { maxItems: MAX_ARTIFACT_FILES }),
  });

/**
 * 도구 결과 `details`에서 산출물 파일 목록을 읽는다(순수 함수). 키가 없거나 모양이 틀리면 빈 목록이다.
 * 다른 키(`truncation`, `sandboxBlocks`, 도구가 낸 값)는 무시한다.
 */
export function artifactFilesOf(details: JsonValue | null): readonly ArtifactFileEntry[] {
  if (details === null) return [];
  const keyed = parse(KeyedDetailsSchema, details);
  return keyed.ok ? keyed.value.artifactFiles : [];
}
