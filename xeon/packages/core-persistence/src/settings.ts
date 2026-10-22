import { Type } from "typebox";
import { err, ok, type Result } from "@xeon/contracts";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";
import { DEFAULT_PERSISTENCE_SETTINGS, type PersistenceSettings } from "./deps.ts";

// L1.persistence.spec §6.1. 모두 layer L1, tab sessions, since 0.1.0이다. 단계(M1~2차)는 구현 시점이고 선언은 한 번에 둔다.
// 기본값은 deps.ts의 DEFAULT_PERSISTENCE_SETTINGS와 이 파일의 보관 정리 상수 한 곳에서 가져온다(BP-06).
const group = defineSettings("l1.persistence", {
  "retention.maxAgeDays": {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 3650 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "number",
      order: 100,
      label: "대화 보관 기간",
      help: "마지막 갱신 뒤 이 일수가 지난 대화를 지운다. 0이면 지우지 않는다",
      unit: "일",
    },
    since: "0.1.0",
  },
  "retention.maxCount": {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 100_000 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "number",
      order: 110,
      label: "대화 최대 개수",
      help: "넘으면 오래된 것부터 지운다. 0이면 상한 없음",
    },
    since: "0.1.0",
  },
  autoResume: {
    type: Type.Boolean(),
    default: DEFAULT_PERSISTENCE_SETTINGS.autoResume,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "toggle",
      order: 120,
      label: "중단된 대화 자동 재개",
      help: "서비스 모드에서 열 때 표식이 남은 대화를 자동으로 재개한다",
    },
    since: "0.1.0",
  },
  maxResumeAttempts: {
    type: Type.Integer(),
    default: DEFAULT_PERSISTENCE_SETTINGS.maxResumeAttempts,
    range: { min: 1, max: 20 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "number",
      order: 130,
      label: "turn당 재개 시도 상한",
      unit: "회",
    },
    since: "0.1.0",
  },
  "export.format": {
    type: Type.String({ maxLength: 16 }),
    default: "pi-jsonl",
    range: { enum: ["pi-jsonl", "xeon-jsonl"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "session"],
    ui: { tab: "sessions", widget: "select", order: 140, label: "내보내기 기본 형식" },
    since: "0.1.0",
  },
});

/** `l1.persistence.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const PERSISTENCE_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

export interface PersistenceSettingIssue {
  /** l1.persistence. 뒤의 이름 */
  readonly name: string;
  readonly message: string;
}

/**
 * 설정 계층이 합친 값(`l1.persistence.` 뒤 이름을 키로 한 객체)을 PersistenceSettings로 검증한다. 없는 키는 기본값이다.
 * 키 선언은 위 PERSISTENCE_SETTING_DEFS다. 이 함수가 읽는 키는 maxResumeAttempts(M1)와 autoResume(M3) 둘이다.
 */
export function resolvePersistenceSettings(
  input: Readonly<Record<string, unknown>>,
): Result<PersistenceSettings, readonly PersistenceSettingIssue[]> {
  const issues: PersistenceSettingIssue[] = [];
  let maxResumeAttempts = DEFAULT_PERSISTENCE_SETTINGS.maxResumeAttempts;
  const attempts = input["maxResumeAttempts"];
  if (attempts !== undefined) {
    if (typeof attempts !== "number" || !Number.isInteger(attempts)) {
      issues.push({ name: "maxResumeAttempts", message: "must be an integer" });
    } else if (attempts < 1 || attempts > 20) {
      issues.push({ name: "maxResumeAttempts", message: "must be between 1 and 20" });
    } else {
      maxResumeAttempts = attempts;
    }
  }
  let autoResume = DEFAULT_PERSISTENCE_SETTINGS.autoResume;
  const auto = input["autoResume"];
  if (auto !== undefined) {
    if (typeof auto === "boolean") autoResume = auto;
    else issues.push({ name: "autoResume", message: "must be a boolean" });
  }
  if (issues.length > 0) return err(issues);
  return ok({ maxResumeAttempts, autoResume });
}
