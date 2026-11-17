import { Type } from "typebox";
import type { SettingDef } from "./def.ts";
import { defineSettings } from "./define.ts";

// `l1.agents.judge.maxRuns`(L1.agents.spec §6). 키의 소유는 L1.agents(core-agents가 `AGENTS_SETTING_DEFS`에 넣는다)다.
// 선언만 F로 올렸다. L2.work(목표 상한 표시와 안내)가 이 키를 읽으려고 core-agents를 import하지 않게 하려는 것이다
// (hooks-core-boundary §6.1 D-30). 기본값과 범위는 core-agents 시절과 같다.

/** 판정 상한 기본값(`l1.agents.judge.maxRuns`) */
export const JUDGE_MAX_RUNS_DEFAULT: number = 3;

const judgeLimit = defineSettings("l1.agents", {
  "judge.maxRuns": {
    type: Type.Integer(),
    default: JUDGE_MAX_RUNS_DEFAULT,
    range: { min: 1, max: 20 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "launch"],
    ui: {
      tab: "models",
      widget: "number",
      order: 330,
      label: "Max goal judge runs",
      unit: "times",
    },
    since: "0.1.0",
  },
});

/** 목표 판정 상한 선언. 정의 값은 core-agents의 `AGENTS_SETTING_DEFS`에도 든다 */
export const JUDGE_MAX_RUNS_SETTING: SettingDef = judgeLimit.defs["judge.maxRuns"];
