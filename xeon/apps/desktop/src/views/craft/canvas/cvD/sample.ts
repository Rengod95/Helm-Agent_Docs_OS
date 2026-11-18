// cvD 표본. 값은 시안 다섯이 함께 보는 `../shared-sample.ts`에서 오고, 여기서는 cvD 모양(자리 키·구성 요소)으로만 바꾼다.
// 플러그인 이름과 스킬·도구·지침 파일 이름은 코드 이름이라 그대로 두고, 사람이 읽는 말은 message id로 적는다.
import type { MessageId } from "@fresnel/client/i18n";
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfile,
  type SharedRisk,
  type SharedStepId,
} from "../shared-sample.ts";

/** 플러그인이 코어 턴에 붙는 방식. 도구는 Inject의 한 갈래지만 캔버스에서는 따로 읽힌다 */
export type Kind = "inject" | "hook" | "drive" | "tool";

/** 엔진 블록 여섯(`blocks.describe`)과 경계 셋. 값은 `@fresnel/contracts/blocks`의 BLOCK_MODEL과 같다 */
export type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
export type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";

/**
 * 플러그인이 붙는 자리 하나.
 * `before:`/`after:`는 블록 앞·뒤의 Hook 자리, `boundary:`는 경계의 Hook 자리,
 * `feed:`는 블록에 들어가는 재료(Inject는 컨텍스트 조립, 도구는 도구 실행), `drive`는 턴을 쥐는 자리다.
 */
export type PointKey =
  | `before:${BlockId}`
  | `after:${BlockId}`
  | `boundary:${BoundaryId}`
  | "feed:context"
  | "feed:tools"
  | "drive";

/** Hook이 하는 결정 */
export type Decision = "block" | "replace" | "ask";

export type Risk = "low" | "medium" | "high";

/** 플러그인 내부의 구성 요소. 내부 화면이 이것을 노드로 그린다 */
export type Part =
  | {
      readonly kind: "instruction";
      readonly id: string;
      /** 지침 파일 이름(식별자라 옮기지 않는다) */
      readonly title: string;
      readonly lines: number;
    }
  | { readonly kind: "skill"; readonly id: string; readonly name: string }
  | { readonly kind: "memory"; readonly id: string; readonly scope: MessageId }
  | {
      readonly kind: "mcp";
      readonly id: string;
      readonly name: string;
      readonly tools: readonly SampleTool[];
    }
  | {
      readonly kind: "handler";
      readonly id: string;
      readonly point: PointKey;
      readonly decision: Decision;
      readonly guard: boolean;
      /** 결정 갈래. 첫째가 그냥 지나가는 길이다 */
      readonly outcomes: readonly MessageId[];
    }
  | {
      readonly kind: "stage";
      readonly id: string;
      readonly label: MessageId;
      readonly parallel: number;
    }
  | { readonly kind: "handoff"; readonly id: string; readonly to: string }
  | { readonly kind: "setting"; readonly id: string; readonly key: string; readonly value: string }
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly risk: Risk;
      readonly scope: MessageId;
    };

interface SampleTool {
  readonly name: string;
  /** 쓰기·실행이면 참(위험 표식) */
  readonly writes: boolean;
}

export interface SamplePlugin {
  readonly id: string;
  readonly kind: Kind;
  /** 플러그인이 선언한 자리. 끌어 놓을 때 이 자리만 열린다 */
  readonly points: readonly PointKey[];
  readonly decision?: Decision;
  /** Hook의 가드 등급(같은 자리에서 프로필 순서보다 먼저 돈다) */
  readonly guard?: boolean;
  /** 리뷰 대기 중인 드래프트 */
  readonly draft?: boolean;
  /** Drive가 핸드오프하는 상대 */
  readonly handoff?: readonly string[];
  /** 노드를 펼치면 보이는 최근 사용(분 전). 쓴 적 없으면 null */
  readonly recent: number | null;
  readonly parts: readonly Part[];
}

export interface SampleGroup {
  readonly id: string;
  readonly name: MessageId;
  readonly members: readonly string[];
}

export interface ProfileEntry {
  readonly plugin: string;
  /** 베이스에서 왔으면 base. 베이스는 모든 프로필에 든다 */
  readonly origin: "profile" | "base";
}

export interface SampleProfile {
  readonly id: string;
  readonly name: MessageId;
  readonly startDrive: string | null;
  /** 순서가 있다. 같은 자리에 여럿이면 이 순서가 호출 순서다(가드 등급이 먼저) */
  readonly entries: readonly ProfileEntry[];
  readonly groups: readonly SampleGroup[];
}

const M = "desktop.craft.canvas.cvD.sample";

const POINT: Readonly<Record<SharedPoint, PointKey>> = {
  "model.before": "before:model",
  "tools.before": "before:tools",
  "tools.after": "after:tools",
  "before-turn-end": "boundary:before-turn-end",
};

const STAGE: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: `${M}.stage.diverge`,
  explore: `${M}.stage.explore`,
  apply: `${M}.stage.apply`,
  check: `${M}.stage.check`,
  judge: `${M}.stage.judge`,
  search: `${M}.stage.search`,
  read: `${M}.stage.read`,
  summarize: `${M}.stage.summarize`,
};

const OUTCOME: Readonly<Record<Decision, MessageId>> = {
  block: `${M}.outcome.block`,
  replace: `${M}.outcome.replace`,
  ask: `${M}.outcome.ask`,
};

function pointsOf(p: SharedPlugin): readonly PointKey[] {
  if (p.kind === "drive") return ["drive"];
  if (p.kind === "tool") return ["feed:tools"];
  if (p.point !== undefined) return [POINT[p.point]];
  return ["feed:context"];
}

const PERMISSION: Readonly<Record<SharedRisk, { readonly risk: Risk; readonly scope: MessageId }>> =
  {
    none: { risk: "low", scope: `${M}.perm.none` },
    read: { risk: "low", scope: `${M}.perm.readOnly` },
    write: { risk: "medium", scope: `${M}.perm.writeFiles` },
    exec: { risk: "medium", scope: `${M}.perm.runCommands` },
  };

function permissionOf(p: SharedPlugin): Part {
  if (p.mcp !== undefined)
    return { kind: "permission", id: "perm", risk: "high", scope: `${M}.perm.network` };
  if (p.risk === "write" && p.memory.length > 0)
    return { kind: "permission", id: "perm", risk: "medium", scope: `${M}.perm.memory` };
  return { kind: "permission", id: "perm", ...PERMISSION[p.risk] };
}

function partsOf(p: SharedPlugin, points: readonly PointKey[]): readonly Part[] {
  const point = points[0];
  return [
    ...(p.steps ?? []).map((s): Part => ({
      kind: "stage",
      id: s.id,
      label: STAGE[s.id],
      parallel: s.parallel,
    })),
    ...(p.handoffTo ?? []).map((to): Part => ({ kind: "handoff", id: `to-${to}`, to })),
    ...(p.kind === "hook" && p.decision !== undefined && point !== undefined
      ? [
          {
            kind: "handler" as const,
            id: "handler",
            point,
            decision: p.decision,
            guard: p.guard === true,
            outcomes: [`${M}.outcome.pass`, OUTCOME[p.decision]] satisfies MessageId[],
          },
        ]
      : []),
    ...p.instructions.map((file): Part => ({
      kind: "instruction",
      id: file,
      title: file,
      lines: 40,
    })),
    ...p.skills.map((name): Part => ({ kind: "skill", id: name, name })),
    ...p.memory.map((m): Part => ({ kind: "memory", id: m, scope: `${M}.memory.project` })),
    ...(p.mcp === undefined
      ? []
      : [{ kind: "mcp" as const, id: "server", name: p.mcp.server, tools: p.mcp.tools }]),
    ...p.settings.map((s): Part => ({ kind: "setting", id: s.key, key: s.key, value: s.value })),
    permissionOf(p),
  ];
}

function pluginFrom(p: SharedPlugin): SamplePlugin {
  const points = pointsOf(p);
  return {
    id: p.name,
    kind: p.kind,
    points,
    ...(p.decision === undefined ? {} : { decision: p.decision }),
    ...(p.guard === true ? { guard: true } : {}),
    ...(p.draft === true ? { draft: true } : {}),
    ...(p.handoffTo === undefined || p.handoffTo.length === 0 ? {} : { handoff: p.handoffTo }),
    recent: p.lastUsedMin,
    parts: partsOf(p, points),
  };
}

/** 왼쪽 목록의 설치된 플러그인(노드 30개 장면의 스물은 그 프로필 안에만 보인다) */
export const SAMPLE_PLUGINS: readonly SamplePlugin[] = SHARED_PLUGINS.map(pluginFrom);
const EVERY: readonly SamplePlugin[] = ALL_SHARED_PLUGINS.map(pluginFrom);

/** 베이스 묶음: 모든 프로필에 든다(`profile.common.get`) */
export const SAMPLE_BASE: readonly string[] = SHARED_PROFILES.dev.base;

function profileFrom(p: SharedProfile, id: string, name: MessageId): SampleProfile {
  return {
    id,
    name,
    startDrive: p.startDrive,
    entries: [
      ...p.base.map((plugin): ProfileEntry => ({ plugin, origin: "base" })),
      ...p.plugins.map((plugin): ProfileEntry => ({ plugin, origin: "profile" })),
    ],
    groups: p.groups.map((g) => ({ id: g.id, name: `${M}.group.quality`, members: g.members })),
  };
}

export const SAMPLE_PROFILES: readonly SampleProfile[] = [
  profileFrom(SHARED_PROFILES.dev, "dev", `${M}.profile.dev`),
  profileFrom(SHARED_PROFILES.empty, "blank", `${M}.profile.blank`),
  profileFrom(SHARED_PROFILES.scale, "scale", "desktop.craft.canvas.sample.scale"),
];

export function pluginById(id: string): SamplePlugin | undefined {
  return EVERY.find((p) => p.id === id);
}
