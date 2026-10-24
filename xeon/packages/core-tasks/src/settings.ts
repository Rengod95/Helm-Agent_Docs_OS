import type { DrainMode, PoolName } from "@xeon/contracts/services";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDefInput,
  type SettingGroup,
} from "@xeon/contracts/settings";
import { Type } from "typebox";
import { DEFAULT_POOL_LIMITS, type TasksSettingsSource } from "./settings-source.ts";

const ALL_SCOPES = ["managed", "user", "project", "local", "session"] as const;

/** l1.tasks.* 설정 키 다섯 개(L1.tasks.spec §6): 동시 상한 셋과 입력 큐 배치 모드 둘 */
export const tasksSettings: SettingGroup<
  "l1.tasks",
  {
    readonly "limits.tools": SettingDefInput;
    readonly "limits.subagents": SettingDefInput;
    readonly "limits.modelCalls": SettingDefInput;
    readonly "queue.steeringMode": SettingDefInput;
    readonly "queue.followUpMode": SettingDefInput;
  }
> = defineSettings("l1.tasks", {
  "limits.tools": {
    type: Type.Integer(),
    default: DEFAULT_POOL_LIMITS.tools,
    range: { min: 1, max: 64 },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "execution", widget: "number", order: 10, label: "동시 도구 실행 수", unit: "개" },
    since: "0.1.0",
  },
  "limits.subagents": {
    type: Type.Integer(),
    default: DEFAULT_POOL_LIMITS.subagents,
    range: { min: 1, max: 100 },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "execution",
      widget: "number",
      order: 20,
      label: "동시 서브에이전트 수",
      unit: "개",
    },
    since: "0.1.0",
  },
  "limits.modelCalls": {
    type: Type.Integer(),
    default: DEFAULT_POOL_LIMITS.modelCalls,
    range: { min: 1, max: 100 },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "execution", widget: "number", order: 30, label: "동시 모델 요청 수", unit: "개" },
    since: "0.1.0",
  },
  "queue.steeringMode": {
    type: Type.String(),
    default: "one-at-a-time",
    range: { enum: ["all", "one-at-a-time"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: { tab: "execution", widget: "select", order: 40, label: "방향 수정 입력 배치" },
    since: "0.1.0",
  },
  "queue.followUpMode": {
    type: Type.String(),
    default: "one-at-a-time",
    range: { enum: ["all", "one-at-a-time"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: { tab: "execution", widget: "select", order: 50, label: "후속 입력 배치" },
    since: "0.1.0",
  },
});

function isDrainMode(value: unknown): value is DrainMode {
  return value === "all" || value === "one-at-a-time";
}

/**
 * 범위별로 읽어 둔 값(ScopeStack)에서 유효 값을 계산해 읽는다. 호출마다 stack()을 다시 부르므로
 * 설정이 바뀌면 다음 배치 지점부터 적용된다(runtimeChange: live). 유효하지 않은 값은 기본값이다
 */
export function createLayeredTasksSettings(stack: () => ScopeStack): TasksSettingsSource {
  function readMode(
    def: (typeof tasksSettings.defs)["queue.steeringMode" | "queue.followUpMode"],
  ): DrainMode {
    const { setting } = resolveSetting(def, stack());
    return isDrainMode(setting.value) ? setting.value : "one-at-a-time";
  }
  function readLimit(pool: PoolName): number {
    const { setting } = resolveSetting(tasksSettings.defs[`limits.${pool}`], stack());
    const value = setting.value;
    return typeof value === "number" && Number.isInteger(value) && value >= 1
      ? value
      : DEFAULT_POOL_LIMITS[pool];
  }
  return {
    steeringMode: () => readMode(tasksSettings.defs["queue.steeringMode"]),
    followUpMode: () => readMode(tasksSettings.defs["queue.followUpMode"]),
    limit: readLimit,
  };
}
