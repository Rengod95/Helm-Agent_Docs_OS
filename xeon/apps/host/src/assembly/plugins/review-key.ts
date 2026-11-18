import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ExtensionNameSchema } from "@fresnel/contracts/extensions";

// 검토본 저장소의 구분 키(M5c §4.6.2, 사용자 결정 2026-11-18 AGE-41). 키를 만드고 풀고 폴더 이름으로 바꾸는 곳은 이 파일 하나다.
// 사용자·번들 출처의 검토본은 이름이 키다. 프로젝트 출처는 `<projectId>/<이름>`이다: 프로젝트 A가 승인한 `foo`가 B의 `foo` 자리에 실리지 않게 한다.
// 디스크 폴더 이름은 슬래시를 쓸 수 없어 `<projectId>~<이름>`이다. 이름 문자 집합(`^[a-z][a-z0-9-]{1,31}$`)에는 `~`와 `/`가 없어
// 두 구분자가 겹치지 않는다. 프로젝트 id는 `[A-Za-z0-9_]`만 쓴다(`prj_<ULID>`, `prj_default`). 점, 슬래시, 역슬래시가 없어 경로 탈출이 없다.

/** 검토본 출처 가운데 저장소에 키로 들어가는 것. 내장과 관리는 검토본을 두지 않는다 */
type ReviewKeyOrigin = "user" | "project" | "bundled";

/** 키를 만들 재료. 프로젝트 출처가 아니면 `projectId`는 무시한다 */
export interface ReviewKeyInput {
  readonly origin: ReviewKeyOrigin;
  readonly name: string;
  readonly projectId?: string | null | undefined;
}

/** 키가 형식에 맞지 않는다. 이름이나 프로젝트 id가 안전한 문자 집합이 아니거나, 프로젝트 출처인데 id가 없다 */
export interface ReviewKeyError {
  readonly kind: "invalid_name";
  readonly name: string;
}

/** 키를 푼 값. 사용자·번들 키는 `projectId`가 null이다 */
export interface ReviewKeyParts {
  readonly name: string;
  readonly projectId: string | null;
}

const KEY_SEPARATOR = "/";
const FOLDER_SEPARATOR = "~";
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

function nameOk(name: string): boolean {
  return parse(ExtensionNameSchema, name).ok;
}

function projectIdOk(projectId: string): boolean {
  return PROJECT_ID_PATTERN.test(projectId);
}

/**
 * 검토본 키. 사용자·번들은 이름 그대로이고, 프로젝트는 `<projectId>/<이름>`이다.
 * 이름이 확장 이름 형식이 아니거나, 프로젝트 출처인데 id가 없거나 형식이 틀리면 `invalid_name`이다
 */
export function reviewKeyOf(input: ReviewKeyInput): Result<string, ReviewKeyError> {
  if (!nameOk(input.name)) return err({ kind: "invalid_name", name: input.name });
  if (input.origin !== "project") return ok(input.name);
  const projectId = input.projectId;
  if (projectId === undefined || projectId === null || !projectIdOk(projectId)) {
    return err({ kind: "invalid_name", name: `${projectId ?? ""}${KEY_SEPARATOR}${input.name}` });
  }
  return ok(`${projectId}${KEY_SEPARATOR}${input.name}`);
}

/** 키를 풀어 이름과 프로젝트 id로 나눈다. 슬래시가 없으면 사용자·번들 키다 */
export function parseReviewKey(key: string): Result<ReviewKeyParts, ReviewKeyError> {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at === -1) {
    if (!nameOk(key)) return err({ kind: "invalid_name", name: key });
    return ok({ name: key, projectId: null });
  }
  const projectId = key.slice(0, at);
  const name = key.slice(at + KEY_SEPARATOR.length);
  const checked = reviewKeyOf({ origin: "project", name, projectId });
  if (!checked.ok) return err({ kind: "invalid_name", name: key });
  return ok({ name, projectId });
}

/**
 * 키의 디스크 폴더 이름(`<projectId>~<이름>`, 사용자·번들은 이름). 키가 `parseReviewKey`를 거친 뒤에만 부른다.
 * 키 형식 검사가 없으면 경로 탈출을 막지 못한다
 */
export function folderNameOf(key: string): string {
  return key.replace(KEY_SEPARATOR, FOLDER_SEPARATOR);
}

/** 디스크 폴더 이름을 키로 바꾼다. 형식이 맞지 않는 폴더(검토본 저장소의 것이 아닌 것)는 `invalid_name`이다 */
export function keyOfFolder(folder: string): Result<string, ReviewKeyError> {
  const at = folder.indexOf(FOLDER_SEPARATOR);
  if (at === -1) {
    if (!nameOk(folder)) return err({ kind: "invalid_name", name: folder });
    return ok(folder);
  }
  const projectId = folder.slice(0, at);
  const name = folder.slice(at + FOLDER_SEPARATOR.length);
  const checked = reviewKeyOf({ origin: "project", name, projectId });
  if (!checked.ok) return err({ kind: "invalid_name", name: folder });
  return ok(checked.value);
}
