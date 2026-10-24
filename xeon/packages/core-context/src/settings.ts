import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";

// L1.context.spec §6. 모두 layer L1, tab sessions, since 0.1.0이다. 단계(M2, 2차)는 구현 시점이고 선언은 한 번에 둔다.
// 범위 약어: M managed, U user, P project, Lo local, S session.

const MUPLoS = ["managed", "user", "project", "local", "session"] as const;
const MUPLo = ["managed", "user", "project", "local"] as const;
const MUP = ["managed", "user", "project"] as const;

const group = defineSettings("l1.context", {
  autoCompact: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "toggle", order: 200, label: "자동 컴팩션" },
    since: "0.1.0",
  },
  reserveTokens: {
    type: Type.Integer(),
    default: 16_384,
    range: { min: 1024, max: 262_144 },
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "number", order: 210, label: "응답용 예약 토큰", unit: "토큰" },
    since: "0.1.0",
  },
  keepRecentTokens: {
    type: Type.Integer(),
    default: 20_000,
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
    default: "",
    runtimeChange: "nextTurn",
    allowedScopes: MUPLo,
    ui: { tab: "sessions", widget: "text", order: 230, label: "컴팩션 지침" },
    since: "0.1.0",
  },
  pruneToolResults: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "sessions", widget: "toggle", order: 240, label: "오래된 도구 결과 줄이기" },
    since: "0.1.0",
  },
  pruneThresholdChars: {
    type: Type.Integer(),
    default: 200,
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
    default: 5,
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
    default: "off",
    range: { enum: ["off", "idle"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: { tab: "sessions", widget: "select", order: 270, label: "프롬프트 캐시 워밍" },
    since: "0.1.0",
  },
});

/** `l1.context.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const CONTEXT_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
