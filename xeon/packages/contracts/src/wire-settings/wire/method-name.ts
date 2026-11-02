/**
 * 메서드 이름 규칙(F.wire-settings.spec §3.2): 코어 `<영역>.<동사>`(M4부터 `<영역>.<하위>.<동사>`도 있다. 예 `work.tasks.list`, `ext.ui.list`), 제어 `$/<이름>`, 확장 `ext.<확장id>.<동사>`.
 * 영역·동사는 소문자로 시작하는 낙타 표기다. `<확장id>`는 ExtensionName 문법이다.
 */
export const METHOD_NAME_PATTERN: string =
  "^(\\$/[a-z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*|(?!ext\\.)[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*|ext\\.[a-z][a-z0-9-]*\\.[a-z][A-Za-z0-9]*)$";

/** `ext.<영역>.<동사>` 세 마디 코어 메서드의 영역. 확장 이름으로 쓸 수 없다(`RESERVED_EXTENSION_NAMES`에도 있다) */
export const CORE_EXT_NAMESPACES: readonly string[] = ["ui", "test"];

/** 확장 메서드의 wire 이름 `ext.<확장이름>.<동사>`(F.wire-settings.spec §4.2). 검사는 하지 않는다 */
export function extMethodName(extension: string, verb: string): string {
  return `ext.${extension}.${verb}`;
}

export type MethodNameKind = "core" | "control" | "extension";

const METHOD_NAME_REGEX = new RegExp(METHOD_NAME_PATTERN);

/** 규칙 위반이면 undefined. 순수 함수 */
export function classifyMethodName(name: string): MethodNameKind | undefined {
  if (name.length === 0 || name.length > 96 || !METHOD_NAME_REGEX.test(name)) return undefined;
  if (name.startsWith("$/")) return "control";
  // "ext.<id>.<동사>"는 세 마디, 코어는 두 마디다. 영역 이름이 "ext"인 코어 메서드는 두지 않는다
  if (name.startsWith("ext.") && name.split(".").length === 3) {
    const area = name.split(".")[1] ?? "";
    return CORE_EXT_NAMESPACES.includes(area) ? "core" : "extension";
  }
  return "core";
}
