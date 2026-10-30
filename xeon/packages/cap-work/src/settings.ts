import { Type } from "typebox";
import { AGENTS_SETTING_DEFS, JUDGE_MAX_RUNS_DEFAULT } from "@xeon/core-agents";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
  type SettingDefInput,
  type SettingGroup,
} from "@xeon/contracts/settings";

// L2.work.spec §6.1. 키 다섯 개를 한 번에 선언한다. 이 마일스톤(WK.1)이 읽는 것은 tasks.* 둘이고,
// plans.*는 WK.2·WK.3, goal.*는 M3(T9~T11)가 읽는다. 상한과 판정 역할은 l1.agents.judge.maxRuns,
// l1.models.routing.judge의 몫이라 여기에 두지 않는다(spec §6.1, W-12).

const workSettings: SettingGroup<
  "l2.work",
  {
    readonly "goal.delegatedTimeoutSec": SettingDefInput;
    readonly "plans.requireApproval": SettingDefInput;
    readonly "plans.exitOnApprove": SettingDefInput;
    readonly "tasks.autoStart": SettingDefInput;
    readonly "tasks.reminderTurns": SettingDefInput;
  }
> = defineSettings("l2.work", {
  "goal.delegatedTimeoutSec": {
    type: Type.Integer(),
    default: 300,
    range: { min: 1, max: 3600 },
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "local"],
    ui: {
      tab: "advanced",
      widget: "number",
      order: 300,
      label: "대리 판정 대기 시간",
      unit: "초",
    },
    since: "0.1.0",
  },
  "plans.requireApproval": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 300,
      label: "계획 승인 필수",
      help: "켜면 승인된 계획이 없을 때 계획 모드를 나갈 수 없습니다",
    },
    since: "0.1.0",
  },
  "plans.exitOnApprove": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "local", "session"],
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 310,
      label: "승인하면 계획 모드 종료",
    },
    since: "0.1.0",
  },
  "tasks.autoStart": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "local", "session"],
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 300,
      label: "선행 작업이 끝나면 자동 시작 표시",
      help: "담당자가 있는 작업에만 적용합니다. 표시만 바꾸고 실행하지는 않습니다",
    },
    since: "0.1.0",
  },
  "tasks.reminderTurns": {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 50 },
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "local", "session"],
    ui: {
      tab: "tools",
      widget: "number",
      order: 310,
      label: "작업 목록 방치 알림",
      help: "0이면 끕니다",
      unit: "턴",
    },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const WORK_SETTING_DEFS: readonly SettingDef[] = Object.values(workSettings.defs);

/** 호출 한 번이 읽는 유효 설정 */
export interface WorkSettings {
  readonly tasks: { readonly autoStart: boolean; readonly reminderTurns: number };
  readonly plans: { readonly requireApproval: boolean; readonly exitOnApprove: boolean };
  readonly goal: { readonly delegatedTimeoutSec: number };
}

export const DEFAULT_WORK_SETTINGS: WorkSettings = {
  tasks: { autoStart: false, reminderTurns: 0 },
  plans: { requireApproval: true, exitOnApprove: true },
  goal: { delegatedTimeoutSec: 300 },
};

/** 설정 층을 돌려준다. 파일 범위와 세션 범위를 합친 스택이다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface WorkSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

function booleanValue(def: SettingDef, layers: ScopeStack, fallback: boolean): boolean {
  const { value } = resolveSetting(def, layers).setting;
  return typeof value === "boolean" ? value : fallback;
}

function integerValue(def: SettingDef, layers: ScopeStack, fallback: number): number {
  const { value } = resolveSetting(def, layers).setting;
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readWorkSettings(layers: ScopeStack): WorkSettings {
  const defs = workSettings.defs;
  const fallback = DEFAULT_WORK_SETTINGS;
  return {
    tasks: {
      autoStart: booleanValue(defs["tasks.autoStart"], layers, fallback.tasks.autoStart),
      reminderTurns: integerValue(
        defs["tasks.reminderTurns"],
        layers,
        fallback.tasks.reminderTurns,
      ),
    },
    plans: {
      requireApproval: booleanValue(
        defs["plans.requireApproval"],
        layers,
        fallback.plans.requireApproval,
      ),
      exitOnApprove: booleanValue(
        defs["plans.exitOnApprove"],
        layers,
        fallback.plans.exitOnApprove,
      ),
    },
    goal: {
      delegatedTimeoutSec: integerValue(
        defs["goal.delegatedTimeoutSec"],
        layers,
        fallback.goal.delegatedTimeoutSec,
      ),
    },
  };
}

const JUDGE_MAX_RUNS_DEF: SettingDef | undefined = AGENTS_SETTING_DEFS.find(
  (def) => def.key === "l1.agents.judge.maxRuns",
);

/**
 * 목표 판정 상한 `l1.agents.judge.maxRuns`의 유효 값. 상한 키는 L1.agents가 소유하므로 그쪽 정의로 읽는다(spec §4.3.2).
 * 정의를 찾지 못하거나 값이 정수가 아니면 L1.agents의 기본값이다
 */
export function readJudgeMaxRuns(layers: ScopeStack): number {
  if (JUDGE_MAX_RUNS_DEF === undefined) return JUDGE_MAX_RUNS_DEFAULT;
  const { value } = resolveSetting(JUDGE_MAX_RUNS_DEF, layers).setting;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : JUDGE_MAX_RUNS_DEFAULT;
}
