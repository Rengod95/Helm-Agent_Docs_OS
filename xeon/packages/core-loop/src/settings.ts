import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";
import type { ThreadId } from "@xeon/contracts/conversation";

// L1.loop.spec §6. 키는 `l1.loop.maxSteps`(M1)와 `l1.loop.gate.maxContinues`(M2)다. repeat.*(2차)는 두지 않는다.

/** 기본값은 이 상수 한 곳에만 둔다(BP-06). 0이면 단계 상한이 없다(pi 방식, L1.loop.spec §4.7) */
export const LOOP_MAX_STEPS_DEFAULT: number = 0;

/** 완료 게이트 계속 상한 기본값. Claude Code Stop 훅 8회, omp `session_stop` 8회를 따른다(L1.loop.spec §4.9) */
export const LOOP_GATE_MAX_CONTINUES_DEFAULT: number = 8;

const SCOPES = ["managed", "user", "project", "local", "session"] as const;

const group = defineSettings("l1.loop", {
  maxSteps: {
    type: Type.Integer(),
    default: LOOP_MAX_STEPS_DEFAULT,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    allowedScopes: SCOPES,
    ui: {
      tab: "budgets",
      widget: "number",
      order: 10,
      label: "turn당 최대 단계",
      help: "0이면 상한 없음",
      unit: "단계",
    },
    since: "0.1.0",
  },
  "gate.maxContinues": {
    type: Type.Integer(),
    default: LOOP_GATE_MAX_CONTINUES_DEFAULT,
    range: { min: 0, max: 100 },
    runtimeChange: "nextTurn",
    allowedScopes: SCOPES,
    ui: {
      tab: "budgets",
      widget: "number",
      order: 20,
      label: "완료 게이트 연속 계속 상한",
      help: "0이면 boundary 계속 지시를 따르지 않음",
      unit: "회",
    },
    since: "0.2.0",
  },
});

/** `l1.loop.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const LOOP_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 루프가 읽는 설정. 값은 설정 서비스가 스키마로 검증해 넘긴다. `nextTurn` 키라 turn 시작 때 한 번 읽는다 */
export interface LoopSettingsSource {
  /** l1.loop.maxSteps. 0이면 상한 없음 */
  maxSteps(threadId: ThreadId): number;
  /** l1.loop.gate.maxContinues. turn 안에서 완료 게이트 계속을 따르는 최대 횟수. 0이면 따르지 않는다 */
  gateMaxContinues(threadId: ThreadId): number;
}

export const DEFAULT_LOOP_SETTINGS: LoopSettingsSource = {
  maxSteps: () => LOOP_MAX_STEPS_DEFAULT,
  gateMaxContinues: () => LOOP_GATE_MAX_CONTINUES_DEFAULT,
};
