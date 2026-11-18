// cvC 시안(고요한 카드)의 표본. 값은 시안 다섯이 함께 보는 `../shared-sample.ts`에서 오고, 여기서는 cvC 모양으로만 바꾼다.
// 프로필 "개발", 빈 프로필(베이스만), 노드 30개, 프로필 밖의 설치된 플러그인 셋, 베이스 둘, 묶음 "품질", 드래프트 `commit-msg`.
// Hook의 자리는 엔진 훅 이름으로 적고 화면이 `BLOCK_MODEL`(contracts)에서 블록과 앞·뒤를 찾는다. 문구는 두지 않는다(화면이 id로 글 키를 찾는다).
import { t } from "@fresnel/client/i18n";
import {
  ALL_SHARED_PLUGINS,
  SHARED_PLUGINS,
  SHARED_PROFILES,
  type SharedPlugin,
  type SharedPoint,
  type SharedProfile,
  type SharedRisk,
} from "../shared-sample.ts";

/** 플러그인이 루프에 붙는 방식 셋과 도구 제공 */
export type PluginKind = "inject" | "hook" | "drive" | "tool";

/** Hook이 하는 결정 */
export type Decision = "block" | "replace" | "ask";

/** Inject·도구가 넣는 것 */
export type GiveKind = "instructions" | "skill" | "memory" | "mcp" | "tool";

export interface Give {
  readonly what: GiveKind;
  readonly count: number;
}

/** 내부 구성 요소의 위험 등급 */
export type Risk = "none" | "low" | "mid" | "high";

/** Drive의 단계 하나. `parallel`이 있으면 그 수만큼 나란히 돈다 */
export type StepId =
  | "diverge"
  | "explore"
  | "apply"
  | "check"
  | "judge"
  | "search"
  | "read"
  | "summarize"
  | "code"
  | "docs"
  | "tests";

export interface DriveStep {
  readonly id: StepId;
  readonly parallel?: readonly StepId[];
}

/** 설정 값 하나(키와 보이는 값) */
interface InsideSetting {
  readonly key: string;
  readonly value: string;
}

/** 플러그인 내부의 구성(내부 화면이 그린다) */
interface Inside {
  /** 컨텍스트에 넣는 것의 이름들(지침 파일, 스킬, 메모리) */
  readonly instructions?: readonly string[];
  readonly skills?: readonly string[];
  readonly memory?: readonly string[];
  /** 쓰는 도구 이름 */
  readonly tools?: readonly string[];
  /** MCP 서버와 그 도구 */
  readonly mcp?: { readonly server: string; readonly tools: readonly string[] };
  /** Drive의 자기 루프 */
  readonly steps?: readonly DriveStep[];
  readonly settings?: readonly InsideSetting[];
  readonly risk: Risk;
  /** 권한 항목(파일 쓰기, 셸 등). 키는 글 키의 끝 */
  readonly permissions: readonly PermissionKey[];
}

export type PermissionKey = "read" | "write" | "shell" | "network" | "none";

export interface SamplePlugin {
  readonly name: string;
  readonly kind: PluginKind;
  /** Hook: 엔진 훅 이름. 자리는 `BLOCK_MODEL`에서 찾는다 */
  readonly hook?: string;
  readonly decision?: Decision;
  /** 가드 등급(같은 자리에서 먼저 돈다) */
  readonly guard?: boolean;
  readonly gives?: readonly Give[];
  /** Drive: 핸드오프하는 대상 */
  readonly handoffTo?: readonly string[];
  /** 최근 사용(분 전). 없으면 쓰인 적 없음 */
  readonly lastUsedMin?: number;
  readonly inside: Inside;
}

export interface SampleGroup {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
}

export interface SampleProfile {
  readonly id: string;
  readonly title: string;
  /** 순서가 있다. 베이스는 여기 없고 `BASE`에서 온다 */
  readonly plugins: readonly string[];
  readonly startDrive: string | null;
  /** 승인 전(리뷰 대기)인 플러그인 */
  readonly drafts: readonly string[];
  readonly groups: readonly SampleGroup[];
}

/** Hook 자리를 엔진 훅 이름으로(도구 실행 앞의 가드는 가드 훅에 선다) */
const HOOK: Readonly<Record<SharedPoint, string>> = {
  "model.before": "request.provider.before",
  "tools.before": "tool.call.before",
  "tools.after": "tool.result",
  "before-turn-end": "boundary.settle.before",
};

function hookOf(p: SharedPlugin): string | undefined {
  if (p.point === undefined) return undefined;
  return p.guard === true && p.point === "tools.before" ? "guard.tool.before" : HOOK[p.point];
}

const RISK: Readonly<Record<SharedRisk, Risk>> = {
  none: "none",
  read: "low",
  write: "mid",
  exec: "high",
};

const PERMISSIONS: Readonly<Record<SharedRisk, readonly PermissionKey[]>> = {
  none: ["none"],
  read: ["read"],
  write: ["read", "write"],
  exec: ["read", "shell"],
};

function permissionsOf(p: SharedPlugin): readonly PermissionKey[] {
  return p.mcp === undefined ? PERMISSIONS[p.risk] : ["network", "write"];
}

function givesOf(p: SharedPlugin): readonly Give[] | undefined {
  if (p.mcp !== undefined)
    return [
      { what: "mcp", count: 1 },
      { what: "tool", count: p.mcp.tools.length },
    ];
  if (p.kind !== "inject") return undefined;
  if (p.skills.length > 0) return [{ what: "skill", count: p.skills.length }];
  if (p.memory.length > 0) return [{ what: "memory", count: p.memory.length }];
  return [{ what: "instructions", count: p.instructions.length }];
}

function stepsOf(p: SharedPlugin): readonly DriveStep[] | undefined {
  return p.steps?.map((s): DriveStep => {
    if (s.parallel < 2) return { id: s.id };
    return { id: s.id, parallel: s.lanes ?? Array.from({ length: s.parallel }, () => s.id) };
  });
}

function pluginFrom(p: SharedPlugin): SamplePlugin {
  const hook = hookOf(p);
  const gives = givesOf(p);
  const steps = stepsOf(p);
  return {
    name: p.name,
    kind: p.kind,
    ...(hook === undefined ? {} : { hook }),
    ...(p.decision === undefined ? {} : { decision: p.decision }),
    ...(p.guard === true ? { guard: true } : {}),
    ...(gives === undefined ? {} : { gives }),
    ...(p.handoffTo === undefined || p.handoffTo.length === 0 ? {} : { handoffTo: p.handoffTo }),
    ...(p.lastUsedMin === null ? {} : { lastUsedMin: p.lastUsedMin }),
    inside: {
      ...(p.instructions.length > 0 ? { instructions: p.instructions } : {}),
      ...(p.skills.length > 0 ? { skills: p.skills } : {}),
      ...(p.memory.length > 0 ? { memory: p.memory } : {}),
      ...(p.mcp === undefined
        ? {}
        : { mcp: { server: p.mcp.server, tools: p.mcp.tools.map((tool) => tool.name) } }),
      ...(steps === undefined ? {} : { steps }),
      ...(p.settings.length > 0 ? { settings: p.settings } : {}),
      risk: RISK[p.risk],
      permissions: permissionsOf(p),
    },
  };
}

/** 설치된 플러그인 전부(프로필 안팎. 노드 30개 장면의 스물은 그 장면의 프로필에만 든다) */
export const CATALOG: readonly SamplePlugin[] = SHARED_PLUGINS.map(pluginFrom);
const EVERY: readonly SamplePlugin[] = ALL_SHARED_PLUGINS.map(pluginFrom);

/** 모든 프로필에 드는 묶음 */
export const BASE: readonly string[] = SHARED_PROFILES.dev.base;

function profileFrom(
  p: SharedProfile,
  id: string,
  title: string,
  quality: SampleGroup,
): SampleProfile {
  return {
    id,
    title,
    plugins: p.plugins,
    startDrive: p.startDrive,
    drafts: p.plugins.filter(isDraft),
    groups: p.groups.map((g) => ({ ...quality, id: g.id, members: g.members })),
  };
}

function isDraft(name: string): boolean {
  return ALL_SHARED_PLUGINS.find((p) => p.name === name)?.draft === true;
}

/** 표본 프로필: "개발", 빈 프로필, 노드 30개. 이름은 화면 언어를 따르므로 부를 때 만든다 */
export function sampleProfiles(): readonly SampleProfile[] {
  const quality: SampleGroup = {
    id: "quality",
    name: t("desktop.craft.canvas.cvC.sample.quality"),
    members: ["lint-on-edit", "verifier"],
  };
  return [
    profileFrom(SHARED_PROFILES.dev, "dev", t("desktop.craft.canvas.cvC.sample.dev"), quality),
    profileFrom(
      SHARED_PROFILES.empty,
      "blank",
      t("desktop.craft.canvas.cvC.sample.blank"),
      quality,
    ),
    profileFrom(SHARED_PROFILES.scale, "scale", t("desktop.craft.canvas.sample.scale"), quality),
  ];
}

export function pluginOf(name: string): SamplePlugin | undefined {
  return EVERY.find((p) => p.name === name);
}
