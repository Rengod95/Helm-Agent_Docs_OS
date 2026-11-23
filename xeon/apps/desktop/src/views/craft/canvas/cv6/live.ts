// 엔진 값을 캔버스 모델로 옮기는 순수 함수(C3 프로필 화면, craft-flows §6.10, §6.11).
// 카드(`plugin.list`)는 플러그인 판이 되고, 프로필(`profile.list`)은 공통 묶음을 베이스로 둔 캔버스 프로필이 된다.
// 블록 상세는 `blocks.applied`의 Hook 자리마다 핸들러 순서(디스패치 순서)를 그대로 읽고, 자리는 `blocks.describe`의 Hook 위치로 가른다.
// 지어낸 값은 없다: 카드에 없는 값(작성자, 라이선스, 기능 requires·provides, 묶음)은 비워 두고 화면은 그 줄을 그리지 않는다.
import {
  HOOK_NAMES,
  HOOK_POSITIONS,
  type HookName,
  type HookPositionRow,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type {
  BlocksAppliedResult,
  CommonSet,
  Profile,
  ProfileInput,
  ProfileIssue,
} from "@fresnel/contracts/wire";
import type { MemberInfo, PermissionMode } from "@fresnel/contracts/services";
import { PERMISSION_MODE_KEY, profileModeFrom } from "../permission-mode-source.ts";
import type { SharedPlugin } from "../shared-sample.ts";
import type { PluginMeta } from "../shared-meta.ts";
import { anchorOfPosition } from "./facts.ts";
import {
  liveBundleOf,
  type Anchor,
  type CanvasProfile,
  type Kind,
  type LiveBundle,
  type Plugin,
} from "./model.ts";

const HOOK_SET: ReadonlySet<string> = new Set(HOOK_NAMES);

function isHookName(name: string): name is HookName {
  return HOOK_SET.has(name);
}

/** 카드의 종류: 도구 종류 선언(`externalTool`)이 있으면 도구, Drive 칸이 있으면 Drive, Hook이 있으면 Hook, 도구나 MCP 서버를 주면 도구, 나머지는 Inject */
export function kindOfCard(card: PluginCard): Kind {
  if (card.externalTool !== undefined) return "tool";
  if (card.does.drive !== null) return "drive";
  if (card.does.hook !== null && card.does.hook.hooks.length > 0) return "hook";
  const inject = card.does.inject;
  if (inject !== null && (inject.mcpServers.length > 0 || inject.tools.length > 0)) return "tool";
  return "inject";
}

/** Hook 위치 하나의 캔버스 자리. 기록 블록의 구독(자리 없는 이벤트)은 기록 블록 뒤에 선다. 내부 Hook은 자리가 없다 */
function anchorOfHookPosition(position: HookPositionRow["positions"][number]): Anchor | null {
  const at = anchorOfPosition(position);
  if (at !== null) return at;
  if (position.kind === "event") return "after:record";
  return null;
}

/** 카드가 붙는 자리. Hook은 첫 Hook의 자리(여럿이면 상세가 전부 보인다). 자리는 카드의 Hook 이름으로 계약의 위치 표에서 읽는다 */
export function anchorOfCard(card: PluginCard): Anchor {
  const kind = kindOfCard(card);
  if (kind === "drive") return "drive";
  if (kind === "tool") return "feed:tools";
  if (kind === "inject") return "feed:context";
  return anchorOfHooks((card.does.hook?.hooks ?? []).map((h) => h.name).filter(isHookName));
}

/** Hook 이름들의 첫 자리. 자리를 아는 이름이 없으면 모델 앞이다 */
function anchorOfHooks(hooks: readonly HookName[]): Anchor {
  for (const hook of hooks) {
    for (const position of HOOK_POSITIONS[hook].positions) {
      const at = anchorOfHookPosition(position);
      if (at !== null) return at;
    }
  }
  return "before:model";
}

function sharedOf(card: PluginCard, kind: Kind): SharedPlugin {
  const inject = card.does.inject;
  const server = inject?.mcpServers[0];
  const tools = inject?.tools ?? [];
  return {
    name: card.name,
    kind,
    code: card.runs.code,
    instructions: (inject?.instructions.always ?? []).map((entry) => entry.path),
    skills: (inject?.instructions.skills ?? []).map((skill) => skill.name),
    memory: [],
    ...(kind === "tool"
      ? {
          mcp: {
            server: server?.name ?? card.name,
            tools: tools.map((tool) => ({ name: tool.name, writes: false })),
          },
        }
      : {}),
    settings: [],
    risk: "none",
    lastUsedMin: null,
  };
}

function metaOfCard(card: PluginCard): PluginMeta {
  const hooks = (card.does.hook?.hooks ?? []).map((h) => h.name).filter(isHookName);
  return {
    displayName: card.displayName,
    purpose: "desktop.craft.canvas.cv9.purposeNone",
    purposeText: card.purpose,
    descriptionText: card.description ?? null,
    version: card.version ?? "",
    author: null,
    license: null,
    origin: card.origin.kind,
    pkg: card.name,
    review: {
      state: card.review.state,
      currentHash: card.review.currentHash,
      approvedAt: card.review.approvedAt,
    },
    pending: null,
    createdByBuilder: card.origin.createdIn !== undefined,
    createdIn: card.origin.createdIn?.threadId ?? null,
    enforcement: card.enforcement,
    isolated: card.runs.isolated,
    cost: {
      always: card.cost.always,
      drive: card.cost.drive,
      onDemand: card.cost.onDemand,
      toolCount: card.cost.toolCount,
    },
    health: card.health.state,
    requires: [],
    optional: [],
    provides: [],
    readsRecordKinds: [],
    recordKinds: [],
    replaces: card.does.inject?.replaces ?? [],
    hooks,
    launch: null,
    usedBy: card.usedBy,
    requiredBy: card.requiredByCore ?? [],
    uiCount: card.does.inject?.ui.length ?? 0,
  };
}

/** 카드 한 장을 캔버스의 플러그인 하나로 */
export function pluginOfCard(card: PluginCard): Plugin {
  const kind = kindOfCard(card);
  return {
    name: card.name,
    kind,
    anchor: anchorOfCard(card),
    shared: sharedOf(card, kind),
    meta: metaOfCard(card),
  };
}

/**
 * 캔버스가 보이는 플러그인: 내부 부품이 아닌 것 전부와, 내부 부품(`internal`) 가운데 어떤 프로필이나 공통 묶음에 든 것.
 * 프로필에 든 이름은 다 보여야 프로필 화면이 프로필 그대로다(엔진이 필요로 해 잠긴 `cap-workspace` 같은 단위도 여기 선다).
 * 어디에도 들지 않은 내부 부품은 엔진이 스스로 싣는 것이라 목록에도 세우지 않는다
 */
export function canvasCards(
  cards: readonly PluginCard[],
  referenced: ReadonlySet<string>,
): readonly PluginCard[] {
  return cards.filter((card) => card.internal !== true || referenced.has(card.name));
}

/** 프로필 목록과 공통 묶음에 든 이름 전부 */
export function referencedNames(
  profiles: readonly Profile[],
  common: CommonSet,
): ReadonlySet<string> {
  return new Set([...common.plugins, ...profiles.flatMap((p) => p.plugins)].map((ref) => ref.name));
}

/** 프로필 하나를 캔버스 프로필로. 공통 묶음이 베이스(앞에 선다)이고, 프로필 목록에서 공통 묶음에도 든 이름은 베이스 자리에 한 번만 선다 */
export function canvasProfileOf(profile: Profile, common: CommonSet): CanvasProfile {
  const base = common.plugins.map((ref) => ref.name);
  return {
    id: profile.id,
    base,
    entries: profile.plugins
      .filter((ref) => !base.includes(ref.name))
      .map((ref) => {
        // 멤버 있는 플러그인(엔진 묶음)은 묶음 하나로 서고 판은 멤버마다다(cvMerge, AGE-72)
        const bundle = liveBundleOf(ref.name);
        return bundle === null
          ? { type: "plugin", name: ref.name }
          : { type: "bundle", id: bundle.id, members: bundle.members };
      }),
    startDrive: profile.startDrive,
  };
}

/**
 * 멤버 하나의 판(cvMerge, AGE-72). 이름은 `<플러그인>/<멤버 id>`(Registration id)이고, 종류와 자리는 멤버의 선언(Drive, Hook 이름)에서
 * 정한다: Drive면 Drive, Hook이 있으면 첫 Hook의 자리, 그 밖에는 Inject. 목적, 설명, 리뷰, 비용 같은 사람용 값은 플러그인 카드의 것이다
 * (멤버마다의 카드는 엔진에 없다). 만든 곳(빌더)은 묶음에 한 번이라 멤버 판에서는 선을 긋지 않는다
 */
export function memberPluginOf(parent: Plugin, member: MemberInfo): Plugin {
  const hooks = member.hooks.filter(isHookName);
  const kind: Kind = member.drives ? "drive" : hooks.length > 0 ? "hook" : "inject";
  const anchor =
    kind === "drive" ? "drive" : kind === "hook" ? anchorOfHooks(hooks) : "feed:context";
  const name = `${parent.name}/${member.id}`;
  return {
    name,
    kind,
    anchor,
    shared: { ...parent.shared, name, kind },
    meta: {
      ...parent.meta,
      displayName: member.title ?? member.id,
      hooks,
      createdByBuilder: false,
      requiredBy: [],
    },
  };
}

/** 엔진 묶음의 머리 값(카드에서): 이름, 보이는 이름, 버전, 출처 */
export function liveBundleOfCard(parent: Plugin, members: readonly string[]): LiveBundle {
  return {
    id: parent.name,
    members,
    meta: {
      id: parent.name,
      displayName: parent.meta.displayName,
      purpose: "desktop.craft.canvas.cv9.purposeNone",
      version: parent.meta.version,
      author: "",
      origin: parent.meta.origin,
      hash: parent.meta.review.currentHash ?? "",
    },
  };
}

/**
 * 캔버스 프로필을 저장할 값으로. 이름, 설정은 저장된 프로필 그대로이고 바뀌는 것은 플러그인 순서와 시작 Drive뿐이다.
 * 저장된 목록에서 공통 묶음과 겹쳐 캔버스가 보이지 않던 이름은 버리지 않고 끝에 둔다(공통 묶음이 먼저 서므로 뜻은 같다)
 */
export function profileInputOf(canvas: CanvasProfile, saved: Profile): ProfileInput {
  // 묶음은 프로필에 이름 하나로 든다(멤버 판 이름을 쓰지 않는다)
  const names = canvas.entries.map((e) => (e.type === "plugin" ? e.name : e.id));
  const kept = saved.plugins.map((ref) => ref.name).filter((name) => !names.includes(name));
  return {
    id: saved.id,
    title: saved.title,
    plugins: [...names, ...kept].map((name) => ({ name })),
    settings: saved.settings,
    startDrive: canvas.startDrive,
  };
}

/** 블록 상세의 한 줄: Hook 이름 하나와 그 자리에 선 핸들러(디스패치 순서) */
export interface PointHook {
  readonly hook: string;
  readonly plugins: readonly string[];
}

/** 이 자리(`anchor`)에 서는 Hook마다 핸들러 순서. 핸들러가 하나도 없는 Hook은 뺀다 */
export function pointHooks(
  applied: BlocksAppliedResult,
  positions: readonly HookPositionRow[],
  anchor: Anchor,
): readonly PointHook[] {
  const here: ReadonlySet<string> = new Set(
    positions
      .filter((row) => row.positions.some((p) => anchorOfHookPosition(p) === anchor))
      .map((row) => row.hook),
  );
  const byHook = new Map<string, { plugin: string; order: number }[]>();
  for (const block of applied.blocks) {
    for (const h of block.handlers) {
      if (!here.has(h.hook)) continue;
      const list = byHook.get(h.hook) ?? [];
      if (!list.some((x) => x.plugin === h.plugin)) list.push({ plugin: h.plugin, order: h.order });
      byHook.set(h.hook, list);
    }
  }
  return [...byHook.entries()]
    .map(([hook, list]) => ({
      hook,
      plugins: list.toSorted((a, b) => a.order - b.order).map((x) => x.plugin),
    }))
    .toSorted((a, b) => a.hook.localeCompare(b.hook));
}

/** 이 이름들 가운데 하나라도 걸린 이슈(충돌, 의존, 시작 Drive 규칙) */
export function issuesOf(
  issues: readonly ProfileIssue[],
  names: readonly string[],
): readonly ProfileIssue[] {
  return issues.filter(
    (issue) =>
      (issue.plugin !== undefined && names.includes(issue.plugin)) ||
      (issue.other !== undefined && names.includes(issue.other.split("/")[0] ?? "")),
  );
}

/** 프로필 이름은 앞뒤 공백을 뗀 1~128자다(계약의 `Title`). 맞지 않으면 null */
export function checkProfileTitle(text: string): string | null {
  const title = text.trim();
  return title.length === 0 || title.length > PROFILE_TITLE_MAX ? null : title;
}

const PROFILE_TITLE_MAX = 128;
/** 계약의 `PROFILE_ID_PATTERN`(`^[a-z][a-z0-9-]{0,47}$`)이 허용하는 가장 긴 id */
const PROFILE_ID_MAX = 48;
/** 이름에서 쓸 글자가 하나도 나오지 않을 때(한글 이름 따위)의 id 바탕 */
const PROFILE_ID_FALLBACK = "profile";

/**
 * 새 프로필의 id를 이름에서 만든다. 영문 소문자와 숫자만 남기고 나머지는 `-` 하나로 줄이며, 글자로 시작하지 않으면 `profile`을 쓴다.
 * 이미 있는 id(`taken`, 숨은 `craft`와 `default` 포함)와 겹치면 `-2`, `-3`…을 붙인다. 엔진은 겹치는 id를 고치지 않고
 * `profile.conflict`로 거절하므로(`profile.put`의 새 저장, `profile.clone`) 화면이 먼저 비어 있는 id를 고른다
 */
export function profileIdFrom(title: string, taken: ReadonlySet<string>): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  const stem = /^[a-z]/.test(slug)
    ? slug.slice(0, PROFILE_ID_MAX).replace(/-+$/, "")
    : PROFILE_ID_FALLBACK;
  const used = new Set([...taken, "default", "craft"]);
  if (!used.has(stem)) return stem;
  const numbered = (n: number): string => {
    const tail = `-${String(n)}`;
    return `${stem.slice(0, PROFILE_ID_MAX - tail.length).replace(/-+$/, "")}${tail}`;
  };
  let n = 2;
  while (used.has(numbered(n))) n += 1;
  return numbered(n);
}

/**
 * 새 빈 프로필의 저장 값. 엔진이 필요로 하는 플러그인(`requiredByCore`)만 든다: 엔진은 그것을 프로필과 무관하게 싣고, 목록에 있어야
 * 캔버스가 잠긴 판으로 그린다. 공통 묶음은 저장 값에 넣지 않아도 베이스로 앞에 선다. 설정은 비워 두어 엔진의 기본값을 따른다
 */
export function newProfileInput(
  id: string,
  title: string,
  required: readonly string[],
): ProfileInput {
  return {
    id,
    title,
    plugins: required.map((name) => ({ name })),
    settings: [],
    startDrive: null,
  };
}

/** 이름만 바꾼 저장 값. 플러그인, 설정, 시작 Drive는 저장된 그대로다 */
export function renamedInput(saved: Profile, title: string): ProfileInput {
  return {
    id: saved.id,
    title,
    plugins: saved.plugins,
    settings: saved.settings,
    startDrive: saved.startDrive,
  };
}

/**
 * 이 프로필을 쓰는 대화의 실행 방식. 엔진의 `profile` 층과 같은 규칙이다(`profileModeFrom`: 프로필 값 > 공통 묶음 값 > 모두 허용).
 * 엔진이 모르는 값이면 null이다. 대화 입력창 칩 메뉴의 "프로필 값으로 되돌리기" 줄도 같은 규칙을 쓴다
 */
export function profileModeOf(saved: Profile, common: CommonSet): PermissionMode | null {
  return profileModeFrom(saved.settings, common.settings);
}

/** 실행 방식만 바꾼 저장 값. 그 키의 옛 줄은 빼고 새 값 한 줄을 끝에 둔다. 이름, 플러그인, 다른 설정, 시작 Drive는 저장된 그대로다 */
export function withModeInput(saved: Profile, mode: PermissionMode): ProfileInput {
  return {
    id: saved.id,
    title: saved.title,
    plugins: saved.plugins,
    settings: [
      ...saved.settings.filter((setting) => setting.key !== PERMISSION_MODE_KEY),
      { key: PERMISSION_MODE_KEY, value: mode },
    ],
    startDrive: saved.startDrive,
  };
}
