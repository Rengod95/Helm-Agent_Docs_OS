// cvA(HUD) 시안의 표본. 값은 시안 다섯이 함께 보는 `../shared-sample.ts`에서 오고, 여기서는 cvA 모델 모양으로만 바꾼다.
// 플러그인 이름과 스킬·도구 이름은 식별자라 번역하지 않는다. 사람이 읽는 말은 words.ts가 키로 찾는다.
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfile,
  type SharedRisk,
} from "../shared-sample.ts";
import type { Grant, Holding, Part, PluginSpec, Port, ProfileModel } from "./model.ts";

const PORT: Readonly<Record<SharedPoint, Port>> = {
  "model.before": "model.before",
  "tools.before": "tools.before",
  "tools.after": "tools.after",
  "before-turn-end": "before-turn-end",
};

/** 위험 등급 하나를 cvA의 권한 줄로 편다 */
function grantsOf(p: SharedPlugin): readonly Grant[] {
  const byRisk: Readonly<Record<SharedRisk, readonly Grant[]>> = {
    none: [],
    read: [{ id: "fileRead", risk: "read" }],
    write: [
      { id: "fileRead", risk: "read" },
      { id: p.memory.length > 0 ? "memoryWrite" : "fileWrite", risk: "write" },
    ],
    exec: [
      { id: "fileRead", risk: "read" },
      { id: "commandRun", risk: "exec" },
    ],
  };
  const network: readonly Grant[] =
    p.mcp === undefined
      ? []
      : [
          { id: "network", risk: "read" },
          { id: "repoWrite", risk: "write" },
        ];
  return p.mcp === undefined ? byRisk[p.risk] : network;
}

function partsOf(p: SharedPlugin): readonly Part[] {
  return [
    ...p.instructions.map((f): Part => ({ id: f, unit: "instruction", label: f })),
    ...p.skills.map((s): Part => ({ id: s, unit: "skill", label: s })),
    ...p.memory.map((m): Part => ({ id: m, unit: "memory", label: m })),
    ...(p.mcp === undefined
      ? []
      : [
          { id: p.mcp.server, unit: "server" as const, label: p.mcp.server },
          ...p.mcp.tools.map((tool): Part => ({ id: tool.name, unit: "tool", label: tool.name })),
        ]),
  ];
}

function holdsOf(p: SharedPlugin): readonly Holding[] {
  if (p.mcp !== undefined)
    return [
      { unit: "server", count: 1 },
      { unit: "tool", count: p.mcp.tools.length },
    ];
  if (p.instructions.length > 0 && p.kind === "inject")
    return [{ unit: "instruction", count: p.instructions.length }];
  if (p.skills.length > 0) return [{ unit: "skill", count: p.skills.length }];
  if (p.memory.length > 0) return [{ unit: "memory", count: p.memory.length }];
  return [];
}

/** 핸드오프를 받는 Drive(다른 Drive의 핸드오프 대상) */
const RECEIVERS = new Set(ALL_SHARED_PLUGINS.flatMap((p) => p.handoffTo ?? []));

function specOf(p: SharedPlugin): PluginSpec {
  const port = p.point === undefined ? undefined : PORT[p.point];
  return {
    name: p.name,
    kind: p.kind,
    holds: holdsOf(p),
    ...(port === undefined ? {} : { port }),
    ...(p.decision === undefined ? {} : { decision: p.decision }),
    ...(p.guard === true ? { guard: true } : {}),
    ...(p.draft === true ? { draft: true } : {}),
    ...(p.handoffTo === undefined || p.handoffTo.length === 0 ? {} : { handoffTo: p.handoffTo }),
    lastUsedMin: p.lastUsedMin,
    inside: {
      code: p.code,
      parts: partsOf(p),
      ...(p.steps === undefined
        ? {}
        : { steps: p.steps.map((s) => ({ id: s.id, step: s.id, lanes: s.parallel })) }),
      ...(p.handoffTo === undefined || p.handoffTo.length === 0 ? {} : { handoff: p.handoffTo }),
      ...(RECEIVERS.has(p.name) ? { receives: true } : {}),
      ...(port === undefined || p.decision === undefined
        ? {}
        : { handler: { port, decision: p.decision } }),
      settings: p.settings,
      grants: grantsOf(p),
    },
  };
}

function profileOf(p: SharedProfile): ProfileModel {
  return {
    id: `sample/${p.id}`,
    base: p.base,
    plugins: p.plugins,
    startDrive: p.startDrive,
    groups: p.groups.map((g) => ({ id: g.id, name: g.id, members: g.members })),
  };
}

/** 설치된 플러그인 전부(왼쪽 목록에 놓이는 순서) */
export const SAMPLE_PLUGINS: readonly PluginSpec[] = SHARED_PLUGINS.map(specOf);
/** 노드 30개 장면의 설치된 플러그인(위 열셋에 스물을 더한다) */
export const SCALE_PLUGINS: readonly PluginSpec[] = ALL_SHARED_PLUGINS.map(specOf);

/** 프로필 "개발". 베이스(모든 프로필에 드는 묶음)는 memory와 secret-guard다 */
export const SAMPLE_PROFILE: ProfileModel = profileOf(SHARED_PROFILES.dev);
/** 빈 프로필(베이스만 든다) */
export const EMPTY_PROFILE: ProfileModel = profileOf(SHARED_PROFILES.empty);
/** 노드 30개 프로필 */
export const SCALE_PROFILE: ProfileModel = profileOf(SHARED_PROFILES.scale);
