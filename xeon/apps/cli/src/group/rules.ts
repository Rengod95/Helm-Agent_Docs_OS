import { Type } from "typebox";
import { t } from "@xeon/client/i18n";
import { err, ok, parse, parseJson, type Result } from "@xeon/contracts";

// L3.slots.spec §3.3.3(템플릿 색인, 치환 자리), §3.3.4(이름 규칙), §3.3.6 R1·R2. `xeon group new`가 쓰는 순수 규칙이다.
// L4는 group-kit을 import하지 않는다(DR-14). 그래서 이름 상수와 색인 스키마를 여기 복사해 둔다.
// test/group-rules.test.ts가 group-kit 소스 텍스트와 비교해 두 목록이 갈라지면 실패한다.

export type GroupTemplateKind = "drive" | "policy" | "observe";

/** 확장 id 규칙(review.decisions-2 U-18). group-kit의 GROUP_NAME_PATTERN과 같은 문자열이다 */
export const GROUP_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";

/** group-kit의 RESERVED_GROUP_NAMES와 같은 목록이다. 순서도 같게 둔다 */
export const RESERVED_GROUP_NAMES: readonly string[] = [
  "core",
  "cap",
  "xh",
  "sys",
  "p",
  "ext",
  "x",
  "grp",
  "xeon",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifacts",
  "schedule",
  "auto",
  "all",
  "none",
  "group",
  "groups",
  "kit",
];

/** 템플릿 치환 자리(L3.slots.spec §3.3.3). 파일 내용과 경로에 모두 적용한다 */
const PLACEHOLDER_ID: string = "__ID__";
const PLACEHOLDER_TITLE: string = "__TITLE__";
const PLACEHOLDER_VERSION: string = "__VERSION__";
/** `__VERSION__`의 기본값(L3.slots.spec §3.3.3) */
export const DEFAULT_GROUP_VERSION: string = "0.1.0";

export interface GroupNameProblem {
  readonly kind: "group_name";
  /** 형식 위반(pattern)인지 예약 이름(reserved)인지 */
  readonly reason: "pattern" | "reserved";
}

/** 그룹 이름을 검사한다(L3.slots.spec §3.3.4, §3.3.6 R2). 설치된 확장과의 충돌은 여기서 보지 않는다 */
export function checkGroupName(name: string): Result<string, GroupNameProblem> {
  if (!new RegExp(GROUP_NAME_PATTERN).test(name)) {
    return err({ kind: "group_name", reason: "pattern" });
  }
  if (RESERVED_GROUP_NAMES.includes(name)) return err({ kind: "group_name", reason: "reserved" });
  return ok(name);
}

interface TemplateEntry {
  readonly description: string;
  /** templates/ 기준 상대 경로. 공통 파일은 "common/…", 종류 파일은 "<종류>/…" */
  readonly files: readonly string[];
  readonly usesDrive: boolean;
}

export interface TemplateIndex {
  readonly schemaVersion: 1;
  readonly templates: { readonly [K in GroupTemplateKind]: TemplateEntry };
}

// group-kit의 TemplateIndexSchema와 같은 모양이다. 타입은 위의 TemplateIndex 인터페이스가 맡는다
const TemplateEntrySchema = Type.Object({
  description: Type.String({ maxLength: 200 }),
  files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  usesDrive: Type.Boolean(),
});

const TemplateIndexSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  templates: Type.Record(
    Type.Union([Type.Literal("drive"), Type.Literal("policy"), Type.Literal("observe")]),
    TemplateEntrySchema,
  ),
});

/** `templates/index.json` 텍스트를 읽는다. 형식이 맞지 않으면 사람이 읽는 이유 한 줄을 돌려준다 */
export function parseTemplateIndex(text: string): Result<TemplateIndex, string> {
  const json = parseJson(text);
  if (!json.ok) return err(t("cli.group.index.notJson"));
  const checked = parse(TemplateIndexSchema, json.value);
  if (!checked.ok) {
    const first = checked.error.issues[0];
    return err(
      first === undefined ? t("cli.group.index.badShape") : `${first.path} ${first.message}`,
    );
  }
  return ok(checked.value);
}

/** 템플릿 상대 경로가 템플릿 디렉터리 밖을 가리키지 않는지 본다. 색인은 디스크에서 읽는 값이라 경계에서 거른다 */
export function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * 템플릿 상대 경로를 생성 대상 상대 경로로 바꾼다. 첫 마디(`common`, 또는 종류 이름)는 템플릿 묶음 이름이라 뗀다.
 * 남는 마디가 없으면 null이다
 */
export function targetPathOf(templatePath: string): string | null {
  const rest = templatePath.split("/").slice(1).join("/");
  return rest === "" ? null : rest;
}

export interface PlaceholderValues {
  readonly id: string;
  readonly title: string;
  readonly version: string;
}

/** 치환 자리 셋을 바꾼다. 그 밖의 템플릿 문법은 없다(L3.slots.spec §3.3.3) */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text
    .replaceAll(PLACEHOLDER_ID, values.id)
    .replaceAll(PLACEHOLDER_TITLE, values.title)
    .replaceAll(PLACEHOLDER_VERSION, values.version);
}
