// cvB 표본. 값은 시안 다섯이 함께 보는 `../shared-sample.ts`에서 오고, 여기서는 cvB 모델 모양(자리·둘째 줄·구성 요소)으로만 바꾼다.
// 핸들러의 "언제" 한 줄과 권한 범위 글은 cvB만의 말이라 이름으로 찾는다(노드 30개 장면의 Hook은 공통 한 줄).
import type { MessageId } from "@fresnel/client/i18n";
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfile,
  type SharedStepId,
} from "../shared-sample.ts";
import {
  catalogOf,
  type Anchor,
  type Catalog,
  type CvbPlugin,
  type Part,
  type ProfileState,
} from "./model.ts";

const ANCHOR: Readonly<Record<SharedPoint, Anchor>> = {
  "model.before": { at: "block", block: "model", side: "before" },
  "tools.before": { at: "block", block: "tools", side: "before" },
  "tools.after": { at: "block", block: "tools", side: "after" },
  "before-turn-end": { at: "boundary", boundary: "before-turn-end" },
};

const STEP: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: "desktop.craft.canvas.cvB.step.diverge",
  explore: "desktop.craft.canvas.cvB.step.explore",
  apply: "desktop.craft.canvas.cvB.step.apply",
  check: "desktop.craft.canvas.cvB.step.check",
  judge: "desktop.craft.canvas.cvB.step.judge",
  search: "desktop.craft.canvas.cvB.step.search",
  read: "desktop.craft.canvas.cvB.step.read",
  summarize: "desktop.craft.canvas.cvB.step.summarize",
};

const WHEN: Readonly<Record<string, MessageId>> = {
  "secret-guard": "desktop.craft.canvas.cvB.when.secret",
  "lint-on-edit": "desktop.craft.canvas.cvB.when.lint",
  "cost-cap": "desktop.craft.canvas.cvB.when.cost",
  "commit-msg": "desktop.craft.canvas.cvB.when.commit",
  "test-runner": "desktop.craft.canvas.cvB.when.tests",
};

function anchorOf(p: SharedPlugin): Anchor {
  if (p.kind === "drive") return { at: "drive" };
  if (p.kind === "tool") return { at: "block", block: "tools", side: "feed" };
  if (p.point !== undefined) return ANCHOR[p.point];
  return { at: "block", block: "context", side: "feed" };
}

function metaOf(p: SharedPlugin): CvbPlugin["meta"] {
  if (p.kind === "hook") return { k: "verb" };
  if (p.mcp !== undefined) return { k: "tools", n: p.mcp.tools.length };
  if (p.kind === "drive")
    return p.steps === undefined || RECEIVERS.has(p.name)
      ? { k: "receives" }
      : { k: "steps", n: p.steps.length };
  if (p.skills.length > 0) return { k: "skills", n: p.skills.length };
  if (p.memory.length > 0) return { k: "memory" };
  return { k: "rules", n: p.instructions.length };
}

function scopesOf(p: SharedPlugin): readonly MessageId[] {
  if (p.risk === "none") return [];
  if (p.mcp !== undefined)
    return ["desktop.craft.canvas.cvB.scope.network", "desktop.craft.canvas.cvB.scope.repo"];
  if (p.kind === "drive" && (p.handoffTo?.length ?? 0) > 0)
    return ["desktop.craft.canvas.cvB.scope.subagents", "desktop.craft.canvas.cvB.scope.ownFolder"];
  return ["desktop.craft.canvas.cvB.scope.ownFolder"];
}

function partsOf(p: SharedPlugin, anchor: Anchor): readonly Part[] {
  const handler: readonly Part[] =
    p.kind === "hook" && p.decision !== undefined
      ? [
          {
            kind: "handler",
            id: "h",
            anchor,
            verb: p.decision,
            guard: p.guard === true,
            when: WHEN[p.name] ?? "desktop.craft.canvas.sample.hookWhen",
          },
        ]
      : [];
  return [
    ...(p.steps ?? []).map((s): Part =>
      s.parallel > 1
        ? { kind: "step", id: s.id, title: STEP[s.id], parallel: s.parallel }
        : { kind: "step", id: s.id, title: STEP[s.id] },
    ),
    ...(p.handoffTo ?? []).map((to): Part => ({ kind: "handoff", id: `to-${to}`, to, back: true })),
    ...handler,
    ...p.skills.map((name, i): Part => ({ kind: "skill", id: `s${String(i + 1)}`, name })),
    ...p.memory.map((m): Part => ({ kind: "memory", id: m, entries: p.memory.length })),
    ...(p.mcp === undefined
      ? []
      : [
          {
            kind: "mcp" as const,
            id: "server",
            server: p.mcp.server,
            command: `${p.mcp.server}-mcp-server`,
            tools: p.mcp.tools.map((tool) => tool.name),
          },
        ]),
    ...p.instructions.map((file): Part => ({ kind: "rule", id: `rule-${file}`, file })),
    ...p.settings.map((s): Part => ({ kind: "setting", id: s.key, key: s.key, value: s.value })),
    { kind: "permission", id: "perm", risk: p.risk, scopes: scopesOf(p) },
  ];
}

/** 핸드오프를 받는 Drive */
const RECEIVERS = new Set(ALL_SHARED_PLUGINS.flatMap((p) => p.handoffTo ?? []));

function pluginOf(p: SharedPlugin): CvbPlugin {
  const anchor = anchorOf(p);
  return {
    id: p.name,
    kind: p.kind,
    anchor,
    meta: metaOf(p),
    ...(p.decision === undefined ? {} : { verb: p.decision }),
    ...(p.guard === true ? { guard: true } : {}),
    ...(p.draft === true ? { draft: true } : {}),
    runsCode: p.code,
    recent: p.lastUsedMin === null ? null : { minutesAgo: p.lastUsedMin, turns: 0 },
    parts: partsOf(p, anchor),
  };
}

function stateOf(p: SharedProfile, title: MessageId): ProfileState {
  return {
    id: p.id,
    title: { id: title },
    entries: [
      ...p.base.map((plugin) => ({ plugin, base: true })),
      ...p.plugins.map((plugin) => ({ plugin, base: false })),
    ],
    startDrive: p.startDrive,
    groups: p.groups.map((g) => ({
      id: g.id,
      title: { id: "desktop.craft.canvas.cvB.sample.quality" },
      members: g.members,
    })),
  };
}

export const SAMPLE_PLUGINS: readonly CvbPlugin[] = SHARED_PLUGINS.map(pluginOf);
/** 노드 30개 장면의 설치된 플러그인 */
export const SCALE_PLUGINS: readonly CvbPlugin[] = ALL_SHARED_PLUGINS.map(pluginOf);

/** 장면 셋의 플러그인을 다 아는 카탈로그(목록에 무엇을 보일지는 장면이 정한다) */
export const SAMPLE_CATALOG: Catalog = catalogOf(SCALE_PLUGINS);

/** 표본 프로필 "개발". 베이스(memory, secret-guard)가 앞에 온다 */
export const SAMPLE_PROFILE: ProfileState = stateOf(
  SHARED_PROFILES.dev,
  "desktop.craft.canvas.cvB.sample.dev",
);

/** 빈 프로필(베이스만 든다) */
export const EMPTY_PROFILE: ProfileState = stateOf(
  SHARED_PROFILES.empty,
  "desktop.craft.canvas.cvB.sample.empty",
);

/** 노드 30개 프로필 */
export const SCALE_PROFILE: ProfileState = stateOf(
  SHARED_PROFILES.scale,
  "desktop.craft.canvas.sample.scale",
);
