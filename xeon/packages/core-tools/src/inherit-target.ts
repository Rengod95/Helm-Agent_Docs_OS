import type { JsonObject } from "@fresnel/contracts/conversation";

// hooks-core-boundary U-11: 승인 상속은 승인 카드가 사용자에게 보여 준 대상에만 쓴다. 경로로 대상을 대조하는 순수 함수.

/**
 * 경로를 비교용으로 다듬는다. `.`과 빈 조각과 중복 슬래시를 지운다. `..`가 있으면 대상을 알 수 없다고 보고 undefined를 돌려준다
 * (엔진은 파일 시스템을 풀지 않으므로 상위 이동이 든 경로는 같은 대상이라고 확신할 수 없다)
 */
function comparablePath(raw: string): string | undefined {
  if (raw === "") return undefined;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return undefined;
    parts.push(part);
  }
  if (parts.length === 0) return undefined;
  return `${raw.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}

/** 호출 입력의 `path` 문자열 인자. 경로 개념이 없거나 문자열이 아니면 undefined다 */
function targetPathOf(input: JsonObject): string | undefined {
  const value = input["path"];
  return typeof value === "string" ? comparablePath(value) : undefined;
}

/** 쓰기 입력의 경로가 검토 카드가 보여 준 파일 목록 안에 있는가 */
export function pathInCard(
  input: JsonObject,
  files: readonly { readonly path: string }[],
): boolean {
  const target = targetPathOf(input);
  return target !== undefined && files.some((file) => comparablePath(file.path) === target);
}

/** 안쪽 호출의 경로가 바깥 호출 인자의 경로와 같은가. 어느 쪽이든 경로를 알 수 없으면 아니다 */
export function samePathAsOuter(inner: JsonObject, outer: JsonObject): boolean {
  const target = targetPathOf(inner);
  return target !== undefined && target === targetPathOf(outer);
}
