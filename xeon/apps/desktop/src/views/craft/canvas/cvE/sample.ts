// cvE "궤도" 시안의 표본. 값은 시안 다섯이 함께 보는 `../shared-sample.ts`에서 오고, 여기서는 cvE 모양(자리·구성 요소)으로만 바꾼다.
// 이름은 식별자라 옮기지 않는다(`raw`). Hook 핸들러가 하는 일 한 마디는 cvE만의 말이라 이름으로 찾는다(text.ts의 꼬리).
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfile,
  type SharedRisk,
} from "../shared-sample.ts";
import type { Defs, HookPoint, Part, PluginDef, ProfileModel } from "./model.ts";

const POINT: Readonly<Record<SharedPoint, HookPoint>> = {
  "model.before": "model.before",
  "tools.before": "tools.before",
  "tools.after": "tools.after",
  "before-turn-end": "turnEnd",
};

const RISK: Readonly<Record<SharedRisk, number>> = { none: 0, read: 1, write: 2, exec: 3 };

/** Hook 핸들러가 하는 일(꼬리). 노드 30개 장면의 Hook은 이름 그대로 둔다 */
const HANDLER: Readonly<Record<string, string>> = {
  "secret-guard": "scanCall",
  "lint-on-edit": "fixResult",
  "cost-cap": "askOverCap",
  "commit-msg": "checkMessage",
  "test-runner": "runTests",
};

function givesOf(p: SharedPlugin): PluginDef["gives"] {
  if (p.mcp !== undefined) return { what: "tool", count: p.mcp.tools.length };
  if (p.kind !== "inject") return undefined;
  if (p.skills.length > 0) return { what: "skill", count: p.skills.length };
  if (p.memory.length > 0) return { what: "memory", count: p.memory.length };
  return { what: "instruction", count: p.instructions.length };
}

function partsOf(p: SharedPlugin, point: HookPoint | undefined): readonly Part[] {
  const handlerKey = HANDLER[p.name];
  return [
    ...(point === undefined || p.decision === undefined
      ? []
      : [
          {
            kind: "handler" as const,
            ...(handlerKey === undefined ? { raw: p.name } : { key: handlerKey }),
            point,
            decision: p.decision,
          },
        ]),
    ...p.instructions.map((raw): Part => ({ kind: "instruction", raw })),
    ...p.skills.map((raw): Part => ({ kind: "skill", raw })),
    ...p.memory.map((raw): Part => ({ kind: "memory", raw })),
    ...(p.mcp === undefined
      ? []
      : [
          { kind: "mcp" as const, raw: p.mcp.server, count: 1 },
          ...p.mcp.tools.map((tool): Part => ({ kind: "tool", raw: tool.name })),
        ]),
    ...p.settings.map((s): Part => ({ kind: "setting", raw: `${s.key}: ${s.value}` })),
    { kind: "permission", risk: RISK[p.risk] },
  ];
}

function defOf(p: SharedPlugin): PluginDef {
  const point = p.point === undefined ? undefined : POINT[p.point];
  const gives = givesOf(p);
  return {
    id: p.name,
    kind: p.kind,
    ...(point === undefined ? {} : { point }),
    ...(p.decision === undefined ? {} : { decision: p.decision }),
    ...(p.guard === true ? { guard: true } : {}),
    ...(gives === undefined ? {} : { gives }),
    ...(p.steps === undefined
      ? {}
      : {
          stages: p.steps.map((s) =>
            s.parallel > 1 ? { key: s.id, parallel: s.parallel } : { key: s.id },
          ),
        }),
    ...(p.handoffTo === undefined || p.handoffTo.length === 0 ? {} : { handoff: p.handoffTo }),
    ...(p.draft === true ? { draft: true } : {}),
    ...(p.lastUsedMin === null ? {} : { usedMin: p.lastUsedMin }),
    parts: partsOf(p, point),
  };
}

/** 장면 셋의 플러그인 정의 전부(목록에 무엇을 보일지는 SAMPLE_INSTALLED와 프로필이 정한다) */
export const SAMPLE_DEFS: Defs = Object.fromEntries(
  ALL_SHARED_PLUGINS.map((p): [string, PluginDef] => [p.name, defOf(p)]),
);

/** 왼쪽 목록의 순서(설치된 플러그인 전부) */
export const SAMPLE_INSTALLED: readonly string[] = SHARED_PLUGINS.map((p) => p.name);

function modelOf(p: SharedProfile): ProfileModel {
  return {
    id: p.id,
    title: p.id,
    sample: true,
    entries: [
      ...p.base.map((id) => ({ id, base: true })),
      ...p.plugins.map((id) => ({ id, base: false })),
    ],
    startDrive: p.startDrive,
    groups: p.groups.map((g) => ({ id: g.id, key: g.id, members: g.members })),
  };
}

export const SAMPLE_PROFILE: ProfileModel = modelOf(SHARED_PROFILES.dev);
/** 빈 프로필(베이스만 든다) */
export const EMPTY_PROFILE: ProfileModel = modelOf(SHARED_PROFILES.empty);
/** 노드 30개 프로필 */
export const SCALE_PROFILE: ProfileModel = modelOf(SHARED_PROFILES.scale);
