import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";
import type { ThreadId } from "@xeon/contracts/conversation";

// L1.loop.spec §6. M1 키는 `l1.loop.maxSteps` 하나다. gate.maxContinues(M2)와 repeat.*(2차)는 두지 않는다.

/** 기본값은 이 상수 한 곳에만 둔다(BP-06). 0이면 단계 상한이 없다(pi 방식, L1.loop.spec §4.7) */
export const LOOP_MAX_STEPS_DEFAULT: number = 0;

const group = defineSettings("l1.loop", {
  maxSteps: {
    type: Type.Integer(),
    default: LOOP_MAX_STEPS_DEFAULT,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "session"],
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
});

/** `l1.loop.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const LOOP_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 루프가 읽는 설정. 값은 설정 서비스가 스키마로 검증해 넘긴다. `nextTurn` 키라 turn 시작 때 한 번 읽는다 */
export interface LoopSettingsSource {
  /** l1.loop.maxSteps. 0이면 상한 없음 */
  maxSteps(threadId: ThreadId): number;
}

export const DEFAULT_LOOP_SETTINGS: LoopSettingsSource = {
  maxSteps: () => LOOP_MAX_STEPS_DEFAULT,
};
