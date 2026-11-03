import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@fresnel/contracts/settings";

// L1.agents.spec §6. 모두 layer L1, since 0.1.0이다. F 12탭에 agents 탭이 없어 ui.tab은 models다
// (review.decisions-2 S-14). 정의 파일은 파일로만 편집하므로 정의 목록 키는 두지 않는다.
// 전체 동시 수는 l1.tasks.limits.subagents가 정하고 여기서 다시 정의하지 않는다.

const FILE_SCOPES = ["managed", "user", "project", "local"] as const;

const group = defineSettings("l1.agents", {
  maxDepth: {
    type: Type.Integer(),
    default: 1,
    range: { min: 0, max: 5 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "models",
      widget: "number",
      order: 300,
      label: "Max subagent depth",
      help: "0 disables subagents",
    },
    since: "0.1.0",
  },
  maxConcurrent: {
    type: Type.Integer(),
    default: 8,
    range: { min: 1, max: 32 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "models",
      widget: "number",
      order: 310,
      label: "Concurrent subagents",
      help: "Concurrent children of one owning tree root",
      unit: "items",
    },
    since: "0.1.0",
  },
  resultMaxChars: {
    type: Type.Integer(),
    default: 24_000,
    range: { min: 1000, max: 200_000 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "models",
      widget: "number",
      order: 320,
      label: "Max subagent result length",
      unit: "chars",
    },
    since: "0.1.0",
  },
  "judge.maxRuns": {
    type: Type.Integer(),
    default: 3,
    range: { min: 1, max: 20 },
    runtimeChange: "nextTurn",
    allowedScopes: [...FILE_SCOPES, "launch"],
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

/** `l1.agents.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const AGENTS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
