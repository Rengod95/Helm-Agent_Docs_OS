// P-21 구성기의 순수 모델(L4.desktop-ux.spec §6.28). 매니페스트의 구성 선언을 블록 줄과 단계 줄로, 검사 이슈를 개수로,
// 프로필 편집 값을 `profile.put` 입력으로 바꾼다. 읽기만 하고 명령은 부르지 않는다.
import { parse } from "@fresnel/contracts";
import {
  CompositionDeclSchema,
  type CompositionDecl,
  type CompositionOp,
  type PhaseNodeKind,
  type PhasesDecl,
} from "@fresnel/contracts/extensions";
import type {
  DevkitIssue,
  ExtensionKind,
  KindEntry,
  ScaffoldInput,
} from "@fresnel/contracts/services";
import {
  PROFILE_ID_PATTERN,
  type Profile,
  type ProfileInput,
  type ProfileSetting,
  type WireManifestIssue,
} from "@fresnel/contracts/wire";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 설치 그룹의 구성. 선언이 없으면 `none`이고 훅 이름으로 짐작하지 않는다(spec §6.28, C-7) */
export type GroupComposition =
  | { readonly kind: "none" }
  | { readonly kind: "declared"; readonly composition: CompositionDecl };

/** `ext.get`의 매니페스트에서 `group.composition`을 읽는다. 없거나 모양이 맞지 않으면 `none`이다 */
export function compositionOf(manifest: Readonly<Record<string, unknown>>): GroupComposition {
  const group = manifest["group"];
  if (!isRecord(group)) return { kind: "none" };
  const declared = group["composition"];
  if (declared === undefined) return { kind: "none" };
  const parsed = parse(CompositionDeclSchema, declared);
  return parsed.ok ? { kind: "declared", composition: parsed.value } : { kind: "none" };
}

export type ProductText = "record" | "post" | "state";

export interface BlockRow {
  readonly id: string;
  /** 제목이 없으면 id */
  readonly title: string;
  readonly stage: string;
  readonly op: CompositionOp;
  readonly summary: string | null;
  readonly hooks: readonly string[];
  readonly consumes: readonly string[];
  /** 블록이 내는 것. 공개 기록은 기록 종류를 뒤에 붙인다 */
  readonly produces: readonly { readonly kind: ProductText; readonly recordKind: string | null }[];
}

export function blockRowsOf(composition: CompositionDecl): readonly BlockRow[] {
  return composition.blocks.map((block) => ({
    id: block.id,
    title: block.title ?? block.id,
    stage: block.stage,
    op: block.op,
    summary: block.summary ?? null,
    hooks: block.hooks ?? [],
    consumes: block.consumes ?? [],
    produces: (block.produces ?? []).map((product) => ({
      kind: product.kind,
      recordKind: product.kind === "record" ? product.recordKind : null,
    })),
  }));
}

export interface IssueSummary {
  readonly errors: number;
  readonly warnings: number;
}

export function issueSummaryOf(issues: readonly WireManifestIssue[]): IssueSummary {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

/** 블록 id → 그 블록의 이슈. `path`에 `blocks[<번호>]` 또는 `/blocks/<번호>`가 있으면 그 번호의 블록에 붙이고, 아니면 어느 블록에도 붙이지 않는다 */
export function issuesByBlockOf(
  composition: CompositionDecl,
  issues: readonly WireManifestIssue[],
): ReadonlyMap<string, readonly WireManifestIssue[]> {
  const byBlock = new Map<string, WireManifestIssue[]>();
  for (const issue of issues) {
    const match = /(?:^|[./])blocks(?:\[(\d+)\]|\/(\d+))/.exec(issue.path);
    const digits = match?.[1] ?? match?.[2];
    const index = digits === undefined ? -1 : Number(digits);
    const block = composition.blocks[index];
    if (block === undefined) continue;
    byBlock.set(block.id, [...(byBlock.get(block.id) ?? []), issue]);
  }
  return byBlock;
}

export interface PhaseRow {
  readonly id: string;
  readonly kind: PhaseNodeKind;
  readonly title: string;
  readonly initial: boolean;
  readonly out: readonly {
    readonly to: string;
    readonly event: string | null;
    readonly when: string | null;
  }[];
}

/** 단계 선언을 위에서 아래로 읽는 줄로 만든다. 선언이 없으면 null이다("단계 선언이 없어요") */
export function phaseRowsOf(composition: CompositionDecl): readonly PhaseRow[] | null {
  const phases = composition.phases;
  if (phases === undefined) return null;
  return phases.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    title: node.title ?? node.id,
    initial: node.id === phases.initial,
    out: phases.transitions
      .filter((transition) => transition.from === node.id)
      .map((transition) => ({
        to: transition.to,
        event: transition.event ?? null,
        when: transition.when ?? null,
      })),
  }));
}

/** 프로필 편집 값. 확장마다 켜기·끄기·그대로 중 하나다. 그대로는 enable·disable 어디에도 넣지 않는다 */
export type ProfileChoice = "on" | "off" | "keep";

export interface ProfileDraft {
  readonly id: string;
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable: readonly string[];
  /** 화면이 고치지 않는 값은 저장할 때 그대로 돌려 보낸다 */
  readonly settings: readonly ProfileSetting[];
  readonly driver: string | null;
  /** 저장된 프로필이면 그 `rev`, 새 프로필이면 null(`profile.put`의 `baseRev`) */
  readonly baseRev: number | null;
}

export function profileDraftOf(profile: Profile | null): ProfileDraft {
  if (profile === null) {
    return {
      id: "",
      title: "",
      enable: [],
      disable: [],
      settings: [],
      driver: null,
      baseRev: null,
    };
  }
  return {
    id: profile.id,
    title: profile.title,
    enable: profile.enable,
    disable: profile.disable,
    settings: profile.settings,
    driver: profile.driver,
    baseRev: profile.rev,
  };
}

export function choiceOf(draft: ProfileDraft, name: string): ProfileChoice {
  if (draft.enable.includes(name)) return "on";
  if (draft.disable.includes(name)) return "off";
  return "keep";
}

export function withChoice(draft: ProfileDraft, name: string, choice: ProfileChoice): ProfileDraft {
  const enable = draft.enable.filter((item) => item !== name);
  const disable = draft.disable.filter((item) => item !== name);
  return {
    ...draft,
    enable: choice === "on" ? [...enable, name] : enable,
    disable: choice === "off" ? [...disable, name] : disable,
  };
}

export type ProfileDraftProblem = "id" | "title";

/** 저장할 수 없는 까닭. 새 프로필이면 id 규칙도 본다(저장된 프로필의 id는 바꾸지 않는다) */
export function profileDraftProblemOf(draft: ProfileDraft): ProfileDraftProblem | null {
  if (draft.baseRev === null && !new RegExp(PROFILE_ID_PATTERN).test(draft.id)) return "id";
  if (draft.title.trim().length === 0) return "title";
  return null;
}

export function profileInputOf(draft: ProfileDraft): ProfileInput {
  return {
    id: draft.id,
    title: draft.title.trim(),
    enable: draft.enable.toSorted(),
    disable: draft.disable.toSorted(),
    settings: draft.settings,
    driver: draft.driver,
  };
}

/** 새 그룹 이름 규칙(`GROUP_NAME_PATTERN`, group-sdk). 예약 이름은 호스트가 `ext.scaffold`에서 거절한다 */
export const NEW_GROUP_NAME_PATTERN = "^[a-z][a-z0-9-]{1,31}$";

/** "새 그룹"의 시작점. 종류 카탈로그(`ext.kinds`)에서 온다(spec §6.29) */
export interface StartPoint {
  readonly id: ExtensionKind;
  readonly title: string;
  readonly status: KindEntry["status"];
  /** 준비 중(`preview`)은 고를 수 있고 막힌(`blocked`)·지원 끝(`deprecated`) 종류는 고를 수 없다 */
  readonly selectable: boolean;
}

export function startPointsOf(kinds: readonly KindEntry[]): readonly StartPoint[] {
  return kinds.map((kind) => ({
    id: kind.id,
    title: kind.title,
    status: kind.status,
    selectable: kind.status === "stable" || kind.status === "preview",
  }));
}

export type NewGroupProblem = "name" | "kind" | "dir";

export interface NewGroupDraft {
  readonly name: string;
  readonly kind: ExtensionKind | null;
  /** 만들 폴더의 부모. 사용자가 고른다 */
  readonly parentDir: string;
}

export function newGroupDraftOf(): NewGroupDraft {
  return { name: "", kind: null, parentDir: "" };
}

/** 이름이 비어 있으면 아직 입력 전이라 null(오류를 보이지 않는다) */
export function newGroupNameErrorOf(name: string): "pattern" | null {
  if (name === "") return null;
  return new RegExp(NEW_GROUP_NAME_PATTERN).test(name) ? null : "pattern";
}

export function newGroupProblemOf(draft: NewGroupDraft): NewGroupProblem | null {
  if (draft.name === "" || newGroupNameErrorOf(draft.name) !== null) return "name";
  if (draft.kind === null) return "kind";
  if (draft.parentDir.trim() === "") return "dir";
  return null;
}

/** 부모 폴더와 이름을 잇는다. 끝의 구분자는 하나만 둔다 */
export function targetDirOf(draft: NewGroupDraft): string {
  const parent = draft.parentDir.trim().replace(/[\\/]+$/, "");
  return draft.name === "" || parent === "" ? "" : `${parent}/${draft.name}`;
}

/** `ext.scaffold` 입력. 시작점이 `plugin-group`이면 비어 있는 `group` 선언을 싣는다(구성은 구성기에서 채운다) */
export function scaffoldInputOf(draft: NewGroupDraft): ScaffoldInput | null {
  if (newGroupProblemOf(draft) !== null || draft.kind === null) return null;
  const base = { kind: draft.kind, name: draft.name, dir: targetDirOf(draft) };
  return draft.kind === "plugin-group" ? { ...base, group: {} } : base;
}

/** `ext.scaffold` 입력에 고친 구성 선언을 싣는다. 시작점이 플러그인 그룹일 때만 `group.composition`이 들어간다 */
export function scaffoldInputWithComposition(
  draft: NewGroupDraft,
  composition: CompositionDecl,
): ScaffoldInput | null {
  const input = scaffoldInputOf(draft);
  if (input === null || input.kind !== "plugin-group") return input;
  return { ...input, group: { composition } };
}

/** 검사 이슈의 개수. 만든 뒤와 코드 보기의 `ext.validate` 결과에 쓴다 */
export function devkitSummaryOf(issues: readonly DevkitIssue[]): IssueSummary {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors += 1;
    else if (issue.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
}

/** 흐름 초안. 설치 그룹은 읽기 전용이고, 초안만 고친다(spec §6.28.2). 값은 `PhasesDecl` 그대로다 */
export type FlowDraft = PhasesDecl;

export function flowDraftOf(composition: CompositionDecl): FlowDraft | null {
  return composition.phases ?? null;
}

/** 새 노드 id: 종류 이름에 번호를 붙여 겹치지 않게 한다 */
export function nextNodeIdOf(draft: FlowDraft, kind: PhaseNodeKind): string {
  const used = new Set(draft.nodes.map((node) => node.id));
  for (let n = 1; ; n += 1) {
    const id = `${kind}-${n}`;
    if (!used.has(id)) return id;
  }
}

export function withNode(draft: FlowDraft, kind: PhaseNodeKind): FlowDraft {
  return { ...draft, nodes: [...draft.nodes, { id: nextNodeIdOf(draft, kind), kind }] };
}

/** 노드를 지운다. 이어진 전이도 지우고, 시작 노드를 지우면 남은 첫 노드가 시작이 된다. 마지막 노드는 지우지 않는다 */
export function withoutNode(draft: FlowDraft, id: string): FlowDraft {
  const nodes = draft.nodes.filter((node) => node.id !== id);
  const first = nodes[0];
  if (first === undefined) return draft;
  return {
    initial: draft.initial === id ? first.id : draft.initial,
    nodes,
    transitions: draft.transitions.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

export function withInitial(draft: FlowDraft, id: string): FlowDraft {
  return draft.nodes.some((node) => node.id === id) ? { ...draft, initial: id } : draft;
}

/** 노드의 제목(빈 값이면 제목 없음)과 사람 확인 질문(`askTitle`)을 고친다 */
export function withNodeText(
  draft: FlowDraft,
  id: string,
  text: { readonly title?: string; readonly askTitle?: string },
): FlowDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      if (node.id !== id) return node;
      const title = (text.title ?? node.title ?? "").trim();
      const ask = (text.askTitle ?? node.askTitle ?? "").trim();
      return {
        id: node.id,
        kind: node.kind,
        ...(title === "" ? {} : { title }),
        ...(ask === "" || node.kind !== "human" ? {} : { askTitle: ask }),
      };
    }),
  };
}

/** 전이를 잇는다. 없는 노드, 같은 노드끼리, 이미 있는 전이는 그대로 둔다 */
export function withTransition(draft: FlowDraft, from: string, to: string): FlowDraft {
  const known = (id: string): boolean => draft.nodes.some((node) => node.id === id);
  if (from === to || !known(from) || !known(to)) return draft;
  if (draft.transitions.some((edge) => edge.from === from && edge.to === to)) return draft;
  return { ...draft, transitions: [...draft.transitions, { from, to }] };
}

export function withoutTransition(draft: FlowDraft, from: string, to: string): FlowDraft {
  return {
    ...draft,
    transitions: draft.transitions.filter((edge) => !(edge.from === from && edge.to === to)),
  };
}

/**
 * 검사 이슈 경로에서 단계 노드 번호를 읽는다. `/phases/nodes/<번호>`(뒤에 `/id`가 붙을 수 있다)만 노드이고,
 * 전이나 시작 단계 같은 나머지 경로는 null이다
 */
export function phaseNodeIndexOf(path: string): number | null {
  const match = /(?:^|\/)phases\/nodes\/(\d+)(?:\/|$)/.exec(path);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** 노드 id → 그 노드의 이슈. 번호가 노드 목록 밖이면 어느 노드에도 붙이지 않는다 */
export function issuesByPhaseNodeOf(
  draft: FlowDraft,
  issues: readonly WireManifestIssue[],
): ReadonlyMap<string, readonly WireManifestIssue[]> {
  const byNode = new Map<string, WireManifestIssue[]>();
  for (const issue of issues) {
    const index = phaseNodeIndexOf(issue.path);
    const node = index === null ? undefined : draft.nodes[index];
    if (node === undefined) continue;
    byNode.set(node.id, [...(byNode.get(node.id) ?? []), issue]);
  }
  return byNode;
}

/** 초안을 `CompositionDecl`로 되돌린다. 검사(`ext.validateComposition`)에 그대로 넣는다 */
export function compositionWithPhases(
  composition: CompositionDecl,
  draft: FlowDraft,
): CompositionDecl {
  return { ...composition, phases: draft };
}

export interface GraphPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export const GRAPH_NODE_WIDTH = 168;
export const GRAPH_COLUMN_STEP = 232;
export const GRAPH_ROW_STEP = 96;

/**
 * 캔버스 자리. 시작 노드에서 전이를 따라 가장 이른 깊이를 열로, 같은 열의 순서를 행으로 둔다.
 * 닿지 않는 노드는 맨 오른쪽 열 뒤에 둔다. 값은 모두 정수이고 같은 입력이면 같은 자리다.
 */
export function graphPlacementsOf(draft: FlowDraft): readonly GraphPlacement[] {
  const depth = new Map<string, number>([[draft.initial, 0]]);
  const queue = [draft.initial];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) break;
    const here = depth.get(current) ?? 0;
    for (const edge of draft.transitions) {
      if (edge.from !== current || depth.has(edge.to)) continue;
      depth.set(edge.to, here + 1);
      queue.push(edge.to);
    }
  }
  const lastColumn = Math.max(-1, ...depth.values());
  const rows = new Map<number, number>();
  return draft.nodes.map((node) => {
    const column = depth.get(node.id) ?? lastColumn + 1;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id: node.id, x: column * GRAPH_COLUMN_STEP, y: row * GRAPH_ROW_STEP };
  });
}

export interface GraphSize {
  readonly width: number;
  readonly height: number;
}

export function graphSizeOf(placements: readonly GraphPlacement[]): GraphSize {
  const right = Math.max(0, ...placements.map((place) => place.x));
  const bottom = Math.max(0, ...placements.map((place) => place.y));
  return { width: right + GRAPH_NODE_WIDTH + 32, height: bottom + GRAPH_ROW_STEP + 16 };
}

/** 개요 편집기(`LayerTree`) 줄: 노드를 깊이 0, 그 노드에서 나가는 전이를 깊이 1로 든다 */
export interface OutlineRow {
  readonly id: string;
  readonly depth: 0 | 1;
  readonly kind: "node" | "transition";
  readonly label: string;
  /** 전이 줄이면 도착 노드 id */
  readonly target: string | null;
  readonly nodeId: string;
}

export function outlineOf(draft: FlowDraft): readonly OutlineRow[] {
  return draft.nodes.flatMap((node) => [
    {
      id: `node:${node.id}`,
      depth: 0 as const,
      kind: "node" as const,
      label: node.title ?? node.id,
      target: null,
      nodeId: node.id,
    },
    ...draft.transitions
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({
        id: `edge:${edge.from}>${edge.to}`,
        depth: 1 as const,
        kind: "transition" as const,
        label: edge.event ?? edge.to,
        target: edge.to,
        nodeId: node.id,
      })),
  ]);
}

/** Test run의 지금 단계 강조: 그 노드는 active, 시작에서 이미 지난 노드는 done이다. 모르면(null) 모두 idle */
export type NodeRunState = "idle" | "active" | "done";

export function runStatesOf(
  draft: FlowDraft,
  phase: string | null,
): ReadonlyMap<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  for (const node of draft.nodes) states.set(node.id, "idle");
  if (phase === null || !states.has(phase)) return states;
  const placements = graphPlacementsOf(draft);
  const column = (id: string): number =>
    (placements.find((place) => place.id === id)?.x ?? 0) / GRAPH_COLUMN_STEP;
  const now = column(phase);
  for (const node of draft.nodes) {
    states.set(node.id, node.id === phase ? "active" : column(node.id) < now ? "done" : "idle");
  }
  return states;
}

/** 프로필의 drive 그룹. 빈 문자열은 자동(null)이다 */
export function withDriver(draft: ProfileDraft, driver: string | null): ProfileDraft {
  return { ...draft, driver: driver === null || driver.trim() === "" ? null : driver };
}

/** 프로필 보기에서 켜고 끌 수 없는 확장: 내장 코어. 잠금 표시만 한다(spec §6.28.3) */
export function coreLockedOf(entry: {
  readonly origin?: string;
  readonly tier: string | null;
}): boolean {
  return entry.tier === "core" || entry.origin === "builtin";
}

/** drive 그룹으로 고를 수 있는 것: 그룹 확장만. 이름 순 */
export function driverChoicesOf(
  entries: readonly { readonly name: string; readonly isGroup: boolean }[],
): readonly string[] {
  return entries
    .filter((entry) => entry.isGroup)
    .map((entry) => entry.name)
    .toSorted();
}
