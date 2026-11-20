import type { Result } from "../base/index.ts";

// 그룹 이름 규칙의 정본(F). group-sdk(`checkOrchestrationName`을 다시 내보낸다)와 제작 코어(core-authoring)가 같은 규칙을 쓴다.

/** 확장 id 규칙(review.decisions-2 U-18). 소문자, 숫자, 하이픈. 밑줄은 쓰지 않는다 */
export const ORCHESTRATION_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";

/**
 * 그룹 이름 예약 목록의 정본. 네 묶음을 합친다.
 * RESERVED_EXT_IDS(eng.context-map §5.4), F.extensions.spec §4.7 name_reserved의 grp·x·fresnel,
 * L2 도메인 이름(_routing/routes.yaml layout L2), 그룹 명령·설정 값과 겹치는 이름.
 * 설치된 확장 이름과의 충돌은 이 상수에 넣지 않는다. validateManifestSet의 name_conflict로 거부한다.
 */
export const RESERVED_ORCHESTRATION_NAMES: readonly string[] = [
  "core",
  "cap",
  "xh",
  "sys",
  "p",
  "ext",
  "x",
  "grp",
  "fresnel",
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

/** checkGroupName이 돌려주는 실패. reason은 이름 형식 위반(pattern)인지 예약 이름인지(reserved)를 가른다 */
export interface OrchestrationNameError {
  readonly kind: "orchestration_name";
  readonly reason: "pattern" | "reserved";
  readonly name: string;
}

const ORCHESTRATION_NAME_REGEX = new RegExp(ORCHESTRATION_NAME_PATTERN);

/**
 * 그룹 이름을 검사한다(L3.slots.spec §3.3.4, 규칙 R2). GROUP_NAME_PATTERN과 RESERVED_GROUP_NAMES만 쓴다.
 * 설치된 확장 이름과의 충돌은 여기서 보지 않는다(validateManifestSet의 name_conflict). 순수 함수다
 */
export function checkOrchestrationName(name: string): Result<string, OrchestrationNameError> {
  if (!ORCHESTRATION_NAME_REGEX.test(name))
    return { ok: false, error: { kind: "orchestration_name", reason: "pattern", name } };
  if (RESERVED_ORCHESTRATION_NAMES.includes(name))
    return { ok: false, error: { kind: "orchestration_name", reason: "reserved", name } };
  return { ok: true, value: name };
}
