import type { DrainMode } from "@xeon/contracts/services";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDefInput,
  type SettingGroup,
} from "@xeon/contracts/settings";
import { Type } from "typebox";
import type { TasksSettingsSource } from "./settings-source.ts";

/**
 * l1.tasks.* 설정 키(L1.tasks.spec §6). M1은 입력 큐 배치 모드 두 개만 연다.
 * 동시 상한 세 키(limits.tools, limits.subagents, limits.modelCalls)는 상한기와 함께 M2에서 더한다(L1.tasks.plan TK-4, TK-6).
 */
export const tasksSettings: SettingGroup<
  "l1.tasks",
  {
    readonly "queue.steeringMode": SettingDefInput;
    readonly "queue.followUpMode": SettingDefInput;
  }
> = defineSettings("l1.tasks", {
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
  function read(def: (typeof tasksSettings.defs)[keyof typeof tasksSettings.defs]): DrainMode {
    const { setting } = resolveSetting(def, stack());
    return isDrainMode(setting.value) ? setting.value : "one-at-a-time";
  }
  return {
    steeringMode: () => read(tasksSettings.defs["queue.steeringMode"]),
    followUpMode: () => read(tasksSettings.defs["queue.followUpMode"]),
  };
}
