// 도구 종류 플러그인의 "준비 상태"(AGE-76 질문 2 "Tool type plugin", plugTab). 플러그인이 기대는 외부 도구(python3, git 같은 것)가
// 이 컴퓨터에 있는지를 화면이 그리는 모양 한 벌이다. 엔진 쪽 계약(필드 이름, 점검)은 리드 plugTool이 만들고 아직 병합되지 않았다.
// 그래서 화면은 카드(`plugin.list`)에 아래 필드가 있을 때만 읽고, 없으면 null이라 줄, 카드, 상세 어디에도 준비 상태를 그리지 않는다.
// 계약이 들어오면 이 파일만 고친다: 필드 이름(`TOOL_READINESS_FIELD`)과 아래 두 인터페이스의 필드 이름을 계약에 맞춘다.

/** 카드에서 읽는 필드 이름. plugTool 계약의 이름으로 바꾸면 된다 */
const TOOL_READINESS_FIELD = "toolReadiness";

/** 도구 하나의 상태: 있음, 없음, 버전 낮음, 앱에 들어 있음(macOS 앱이 묶어 오는 sops, age, rg 같은 것) */
export const TOOL_NEED_STATES = ["ready", "missing", "tooOld", "bundled"] as const;
export type ToolNeedState = (typeof TOOL_NEED_STATES)[number];

export interface ToolNeedVM {
  /** 도구 이름(명령 이름 그대로, 예: "python3") */
  readonly tool: string;
  readonly state: ToolNeedState;
  /** 없어도 플러그인이 돌면 false(선택) */
  readonly required: boolean;
  readonly minVersion: string | null;
  readonly foundVersion: string | null;
  /** 왜 필요한지 한 줄 */
  readonly why: string | null;
  /** 설치 안내 한 줄(복사 단추가 복사하는 글, 예: "brew install python@3.12"). 앱이 대신 설치하지 않는다 */
  readonly install: string | null;
}

export interface ToolReadinessVM {
  readonly needs: readonly ToolNeedVM[];
  /** 마지막으로 확인한 때(ISO 8601). 모르면 null */
  readonly checkedAt: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 200);
}

function isNeedState(value: unknown): value is ToolNeedState {
  return TOOL_NEED_STATES.some((state) => state === value);
}

function needOf(value: unknown): ToolNeedVM | null {
  if (!isRecord(value)) return null;
  const { tool, state, required, minVersion, foundVersion, why, install } = value;
  if (typeof tool !== "string" || tool.length === 0 || tool.length > 64) return null;
  if (!isNeedState(state) || typeof required !== "boolean") return null;
  if (
    !isTextOrNull(minVersion) ||
    !isTextOrNull(foundVersion) ||
    !isTextOrNull(why) ||
    !isTextOrNull(install)
  ) {
    return null;
  }
  return { tool, state, required, minVersion, foundVersion, why, install };
}

/** 엔진 값 하나를 준비 상태로 읽는다. 모양이 하나라도 틀리면 null(계약이 바뀐 신호라 지어내지 않는다) */
function readinessOfValue(value: unknown): ToolReadinessVM | null {
  if (!isRecord(value)) return null;
  const { needs, checkedAt } = value;
  if (!Array.isArray(needs) || !isTextOrNull(checkedAt)) return null;
  const read: ToolNeedVM[] = [];
  for (const item of needs) {
    const need = needOf(item);
    if (need === null) return null;
    read.push(need);
  }
  return { needs: read, checkedAt };
}

/**
 * 카드(또는 계약이 정할 다른 엔진 값)에서 준비 상태를 읽는다. 필드가 없거나, 모양이 맞지 않거나, 도구가 하나도 없으면 null이다(화면은 그리지 않는다)
 */
export function toolReadinessOf(source: object): ToolReadinessVM | null {
  if (!(TOOL_READINESS_FIELD in source)) return null;
  const readiness = readinessOfValue(source[TOOL_READINESS_FIELD]);
  return readiness === null || readiness.needs.length === 0 ? null : readiness;
}

/** 꼭 필요한 도구가 없거나 버전이 낮은가. 목록과 상세 머리의 상태 칸이 "준비 안 됨"을 보인다 */
export function readinessBlocked(readiness: ToolReadinessVM | null): boolean {
  return (
    readiness !== null &&
    readiness.needs.some(
      (need) => need.required && (need.state === "missing" || need.state === "tooOld"),
    )
  );
}
