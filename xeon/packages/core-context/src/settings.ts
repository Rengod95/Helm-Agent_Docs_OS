import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";

// L1.context.spec §6. 모두 layer L1, tab sessions, since 0.1.0이다. 단계(M2, 2차)는 구현 시점이고 선언은 한 번에 둔다.
// 범위 약어: M managed, U user, P project, Lo local, S session.

/** 서비스가 읽는 `l1.context.*` 값. 기본값은 이 상수 한 곳에만 둔다(BP-06) */
export interface ContextSettings {
  readonly autoCompact: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
  readonly compactionInstructions: string;
  /** 2차 키: 읽기만 하고 아직 쓰지 않는다 */
  readonly pruneToolResults: boolean;
  readonly pruneThresholdChars: number;
  readonly reinjectRecentFiles: number;
  readonly cacheWarming: "off" | "idle";
}

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  autoCompact: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  compactionInstructions: "",
  pruneToolResults: false,
  pruneThresholdChars: 200,
  reinjectRecentFiles: 5,
  cacheWarming: "off",
};

/** 호출 시점의 유효 설정을 읽는 함수. 읽는 경로는 조립 루트가 넘긴다 */
export type ContextSettingsSource = () => ContextSettings;

const MUPLoS = ["managed", "user", "project", "local", "session"] as const;
const MUPLo = ["managed", "user", "project", "local"] as const;
const MUP = ["managed", "user", "project"] as const;

const group = defineSettings("l1.context", {
  autoCompact: {
    type: Type.Boolean(),
    default: DEFAULT_CONTEXT_SETTINGS.autoCompact,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "toggle", order: 200, label: "자동 컴팩션" },
    since: "0.1.0",
  },
  reserveTokens: {
    type: Type.Integer(),
    default: DEFAULT_CONTEXT_SETTINGS.reserveTokens,
    range: { min: 1024, max: 262_144 },
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "number", order: 210, label: "응답용 예약 토큰", unit: "토큰" },
    since: "0.1.0",
  },
  keepRecentTokens: {
    type: Type.Integer(),
    default: DEFAULT_CONTEXT_SETTINGS.keepRecentTokens,
    range: { min: 1024, max: 262_144 },
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: {
      tab: "sessions",
      widget: "number",
      order: 220,
      label: "컴팩션 뒤 유지할 최근 토큰",
      unit: "토큰",
    },
    since: "0.1.0",
  },
  compactionInstructions: {
    type: Type.String({ maxLength: 4000 }),
    default: DEFAULT_CONTEXT_SETTINGS.compactionInstructions,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLo,
    ui: { tab: "sessions", widget: "text", order: 230, label: "컴팩션 지침" },
    since: "0.1.0",
  },
  pruneToolResults: {
    type: Type.Boolean(),
    default: DEFAULT_CONTEXT_SETTINGS.pruneToolResults,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "toggle", order: 240, label: "오래된 도구 결과 줄이기" },
    since: "0.1.0",
  },
  pruneThresholdChars: {
    type: Type.Integer(),
    default: DEFAULT_CONTEXT_SETTINGS.pruneThresholdChars,
    range: { min: 50, max: 100_000 },
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: {
      tab: "sessions",
      widget: "number",
      order: 250,
      label: "도구 결과 줄이기 기준",
      unit: "자",
    },
    since: "0.1.0",
  },
  reinjectRecentFiles: {
    type: Type.Integer(),
    default: DEFAULT_CONTEXT_SETTINGS.reinjectRecentFiles,
    range: { min: 0, max: 20 },
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: {
      tab: "sessions",
      widget: "number",
      order: 260,
      label: "컴팩션 뒤 다시 넣을 최근 파일",
      unit: "개",
    },
    since: "0.1.0",
  },
  cacheWarming: {
    type: Type.String({ maxLength: 8 }),
    default: DEFAULT_CONTEXT_SETTINGS.cacheWarming,
    range: { enum: ["off", "idle"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: { tab: "sessions", widget: "select", order: 270, label: "프롬프트 캐시 워밍" },
    since: "0.1.0",
  },
});

export type ContextSettingReader = (key: string) => unknown;

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * 설정 읽기 함수로 ContextSettings를 만든다. 조립 루트의 `ContextSettingsSource`가 호출 때마다 부른다.
 * 범위를 벗어난 값은 그 키만 기본값을 쓴다(설정 서비스가 쓰기 때 이미 검사하므로 손으로 고친 파일이 아니면 일어나지 않는다)
 */
export function contextSettingsOf(read: ContextSettingReader): ContextSettings {
  const d = DEFAULT_CONTEXT_SETTINGS;
  const instructions = read("l1.context.compactionInstructions");
  const warming = read("l1.context.cacheWarming");
  return {
    autoCompact: boolOr(read("l1.context.autoCompact"), d.autoCompact),
    reserveTokens: intIn(read("l1.context.reserveTokens"), 1024, 262_144, d.reserveTokens),
    keepRecentTokens: intIn(read("l1.context.keepRecentTokens"), 1024, 262_144, d.keepRecentTokens),
    compactionInstructions:
      typeof instructions === "string" && instructions.length <= 4000
        ? instructions
        : d.compactionInstructions,
    pruneToolResults: boolOr(read("l1.context.pruneToolResults"), d.pruneToolResults),
    pruneThresholdChars: intIn(
      read("l1.context.pruneThresholdChars"),
      50,
      100_000,
      d.pruneThresholdChars,
    ),
    reinjectRecentFiles: intIn(
      read("l1.context.reinjectRecentFiles"),
      0,
      20,
      d.reinjectRecentFiles,
    ),
    cacheWarming: warming === "idle" ? "idle" : "off",
  };
}

/** `l1.context.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const CONTEXT_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
