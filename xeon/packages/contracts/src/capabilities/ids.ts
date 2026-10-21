import { Type, type TString } from "typebox";

/** 능력 ID. 점으로 이은 소문자 세그먼트 2~4개. 예: "web.search", "knowledge.memory.read" */
export type CapabilityId = `${string}.${string}`;
export const CAPABILITY_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,31}(\\.[a-z][a-z0-9-]{0,31}){1,3}$";
export const CapabilityIdSchema: TString = Type.String({
  pattern: CAPABILITY_ID_PATTERN,
  maxLength: 96,
});

/** 예약된 첫 세그먼트. 외부 능력 ID가 쓸 수 없다. */
export const RESERVED_CAPABILITY_PREFIXES: readonly string[] = ["core", "ext", "grp", "x"];

/** semver 2.0 정확 버전. 예: "1.2.0" */
export type SemVer = `${number}.${number}.${number}` | `${number}.${number}.${number}-${string}`;
export const SEMVER_PATTERN: string =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$";
export const SemVerSchema: TString = Type.String({ pattern: SEMVER_PATTERN, maxLength: 128 });

/** semver 범위. 허용 형식은 isSemVerRange가 정한다(부분 집합) */
export type SemVerRange = string;
export const SemVerRangeSchema: TString = Type.String({ minLength: 1, maxLength: 64 });

/** 도구 기계 이름 */
export type ToolName = string;
/** 내장 능력 도구의 작성 규칙(경고 기준) */
export const TOOL_NAME_PATTERN: string = "^[a-z][a-z0-9_]{0,63}$";
/** provider 허용 문자(오류 기준) */
export const TOOL_NAME_WIRE_PATTERN: string = "^[a-zA-Z0-9_-]{1,64}$";
/** 확장 모델 도구의 정식 이름 "<확장 이름>__<이름>"(X.operations.spec §4.5). 전체 길이는 TOOL_NAME_WIRE_PATTERN의 64자 */
export const EXTENSION_TOOL_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}__[a-z][a-z0-9_]*$";
export const ToolNameSchema: TString = Type.String({ pattern: TOOL_NAME_WIRE_PATTERN });

const CAPABILITY_ID_REGEX = new RegExp(CAPABILITY_ID_PATTERN);
const SEMVER_REGEX = new RegExp(SEMVER_PATTERN);

/** 능력 ID 문자열 검사. 동적 입력(매니페스트, 와이어)에서 쓴다 */
export function isCapabilityId(value: string): value is CapabilityId {
  return value.length <= 96 && CAPABILITY_ID_REGEX.test(value);
}

export function isSemVer(value: string): value is SemVer {
  return value.length <= 128 && SEMVER_REGEX.test(value);
}

const NUMERIC_SEMVER = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const RANGE_REGEX = new RegExp(
  `^(?:[\\^~]|>=)?${NUMERIC_SEMVER}$|^>=${NUMERIC_SEMVER} <${NUMERIC_SEMVER}$`,
);

/**
 * 허용 형식(F.capabilities.spec §4.1): `x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`, `>=x.y.z <a.b.c`.
 * 와일드카드와 `||`는 허용하지 않는다. 범위 만족 계산은 X가 하고 F는 형식만 검사한다.
 */
export function isSemVerRange(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && RANGE_REGEX.test(value);
}
