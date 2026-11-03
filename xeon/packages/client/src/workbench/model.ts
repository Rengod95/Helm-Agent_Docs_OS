import { assertNever } from "@fresnel/contracts";
import type { ExtListEntry, ExtVersionsResult } from "@fresnel/contracts/wire";

// 크래프트(LightCraft, 코드 id `workbench`) 공유 상태의 순수 모델. spec L4.desktop-ux §6.21~§6.24.
// 크래프트는 전역 상태만 다룬다(2026-11-03 (4)): 범위와 맥락 칸이 없고, 켜기·끄기는 사용자 범위(`user`) 값 하나다.
// 그룹은 스위치 하나다(15-1). 지도·순서·링크(T-CANVAS)와 선택 패널·층 패널·자세히 보기(T-BENCH)가 같은 값을 읽는다.
// 스토어(zustand)는 앱의 `state/workbench`가 이 파일의 함수로 감싼다.

/** 개요의 보기 셋. 기본은 지도 */
export const WORKBENCH_VIEWS = ["orbit", "strata", "link"] as const;
export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

/** 도구 막대 "구성 요소" 필터 값. 비어 있으면 거르지 않는다 */
export const COMPONENT_KINDS = [
  "hook",
  "skill",
  "command",
  "tool",
  "mcp",
  "subagent",
  "ui",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export type ListStatus = "idle" | "loading" | "ready" | "error";

/** 층 패널이 열린 층. 지도의 고리를 누르면 정해진다 */
export type LayerKey = string;

export interface WorkbenchState {
  readonly list: ListStatus;
  /** `ext.list` 결과(이름순이 아니라 호스트가 준 순서) */
  readonly entries: readonly ExtListEntry[];
  readonly view: WorkbenchView;
  /** 고른 확장 이름. 지도와 순서가 같은 값을 읽는다 */
  readonly selected: string | null;
  /** 자세히 보기로 열린 확장 이름. 있으면 캔버스 전체가 그 확장 하나로 바뀐다 */
  readonly detail: string | null;
  readonly layer: LayerKey | null;
  readonly query: string;
  readonly kinds: readonly ComponentKind[];
  /** 켜기·끄기 요청이 아직 반영되지 않은 확장 이름과 목표 값 */
  readonly pending: Readonly<Record<string, boolean>>;
}

export const INITIAL_WORKBENCH: WorkbenchState = {
  list: "idle",
  entries: [],
  view: "orbit",
  selected: null,
  detail: null,
  layer: null,
  query: "",
  kinds: [],
  pending: {},
};

export function listLoading(s: WorkbenchState): WorkbenchState {
  return { ...s, list: "loading" };
}

export function listFailed(s: WorkbenchState): WorkbenchState {
  return { ...s, list: "error" };
}

/** 목록이 들어오면 사라진 확장을 가리키는 고름·자세히 보기·반영된 대기 표시를 걷어 낸다 */
export function listLoaded(s: WorkbenchState, entries: readonly ExtListEntry[]): WorkbenchState {
  const names = new Set(entries.map((e) => e.name));
  const pending: Record<string, boolean> = {};
  for (const [name, target] of Object.entries(s.pending)) {
    const entry = entries.find((e) => e.name === name);
    if (entry !== undefined && isOn(entry) !== target) pending[name] = target;
  }
  return {
    ...s,
    list: "ready",
    entries,
    selected: s.selected !== null && names.has(s.selected) ? s.selected : null,
    detail: s.detail !== null && names.has(s.detail) ? s.detail : null,
    pending,
  };
}

export function setView(s: WorkbenchState, view: WorkbenchView): WorkbenchState {
  return { ...s, view, detail: null };
}

export function select(s: WorkbenchState, name: string | null): WorkbenchState {
  return { ...s, selected: name };
}

export function openDetail(s: WorkbenchState, name: string): WorkbenchState {
  return { ...s, selected: name, detail: name };
}

export function closeDetail(s: WorkbenchState): WorkbenchState {
  return { ...s, detail: null };
}

export function openLayer(s: WorkbenchState, layer: LayerKey | null): WorkbenchState {
  return { ...s, layer };
}

export function setQuery(s: WorkbenchState, query: string): WorkbenchState {
  return { ...s, query };
}

export function toggleKind(s: WorkbenchState, kind: ComponentKind): WorkbenchState {
  const kinds = s.kinds.includes(kind) ? s.kinds.filter((k) => k !== kind) : [...s.kinds, kind];
  return { ...s, kinds };
}

export function markPending(s: WorkbenchState, name: string, target: boolean): WorkbenchState {
  return { ...s, pending: { ...s.pending, [name]: target } };
}

export function clearPending(s: WorkbenchState, name: string): WorkbenchState {
  const { [name]: _removed, ...rest } = s.pending;
  return { ...s, pending: rest };
}

// ───────── 행 모델(확장 행, V-16) ─────────

/** 확장 행의 종류 열. 핵심(core) 층은 `core`, 그룹 선언이 있으면 `group` */
export type ExtKind = "group" | "plugin" | "core";

export type ExtState = "on" | "off" | "enabling" | "disabling" | "auto_disabled" | "safe_excluded";

export type ToggleLock = "exempt" | "safe_mode" | "managed" | null;

export interface ExtRowVM {
  readonly name: string;
  /** 표시 이름. 매니페스트 `displayName`이 이름과 같으면 id만 쓰라는 뜻으로 `null`(화면은 mono id만 보인다) */
  readonly displayName: string | null;
  readonly layer: string;
  readonly kind: ExtKind;
  readonly grade: string;
  readonly state: ExtState;
  readonly on: boolean;
  readonly version: string;
  readonly origin: ExtListEntry["origin"];
  readonly hookCount: number;
  readonly failed: boolean;
  /** 스위치가 잠긴 이유. 잠기지 않으면 null */
  readonly lock: ToggleLock;
  /** 켜기·끄기 요청이 반영되길 기다리는 목표 값. 없으면 null */
  readonly pendingTarget: boolean | null;
}

/** 면제 tier(guard, core)는 끌 수 없다(`AUTO_DISABLE_EXEMPT_TIERS`) */
const EXEMPT_TIERS: ReadonlySet<string> = new Set(["guard", "core"]);

export function isOn(e: ExtListEntry): boolean {
  return e.status === "enabled" || e.status === "enabling";
}

function stateOf(e: ExtListEntry): ExtState {
  if (e.safeModeExcluded !== null) return "safe_excluded";
  if (e.autoDisabled) return "auto_disabled";
  switch (e.status) {
    case "enabled":
      return "on";
    case "enabling":
      return "enabling";
    case "disabling":
      return "disabling";
    case "disabled":
      return "off";
    default:
      return assertNever(e.status, "RegistrationStatus");
  }
}

function kindOf(e: ExtListEntry): ExtKind {
  if (e.layer === "L1") return "core";
  return e.isGroup ? "group" : "plugin";
}

function lockOf(e: ExtListEntry): ToggleLock {
  if (e.safeModeExcluded !== null) return "safe_mode";
  if (e.tier !== null && EXEMPT_TIERS.has(e.tier)) return "exempt";
  if (e.enabledSource === "managed") return "managed";
  return null;
}

export function rowOf(e: ExtListEntry, pending: WorkbenchState["pending"]): ExtRowVM {
  const target = pending[e.name];
  return {
    name: e.name,
    displayName: e.displayName === e.name ? null : e.displayName,
    layer: e.layer,
    kind: kindOf(e),
    grade: e.effectiveGrade,
    state: stateOf(e),
    on: isOn(e),
    version: e.version,
    origin: e.origin,
    hookCount: e.hookCount,
    failed: e.autoDisabled || e.diagnostics.some((d) => d.severity === "error"),
    lock: lockOf(e),
    pendingTarget: target === undefined ? null : target,
  };
}

const matchesQuery = (e: ExtListEntry, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return e.name.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q);
};

/** 찾기로 거른 확장 행. 구성 요소 필터는 매니페스트 읽기(`ext.get`)가 필요해 지도·순서가 자기 데이터로 건다 */
export function visibleRows(s: WorkbenchState): readonly ExtRowVM[] {
  return s.entries.filter((e) => matchesQuery(e, s.query)).map((e) => rowOf(e, s.pending));
}

export interface LayerGroupVM {
  readonly layer: string;
  readonly total: number;
  readonly on: number;
  readonly rows: readonly ExtRowVM[];
}

const LAYER_ORDER: readonly string[] = ["L1", "L2", "L3", "external"];

function layerRank(layer: string): number {
  const i = LAYER_ORDER.indexOf(layer);
  return i === -1 ? LAYER_ORDER.length : i;
}

/** 층별 묶음(층 패널과 지도의 고리 재료). 알려진 층은 L1 → L2 → L3 → 그 밖, 나머지는 이름순 */
export function layerGroups(s: WorkbenchState): readonly LayerGroupVM[] {
  const byLayer = new Map<string, ExtRowVM[]>();
  for (const row of visibleRows(s)) {
    const list = byLayer.get(row.layer);
    if (list === undefined) byLayer.set(row.layer, [row]);
    else list.push(row);
  }
  return [...byLayer.entries()]
    .toSorted(([a], [b]) => layerRank(a) - layerRank(b) || a.localeCompare(b))
    .map(([layer, rows]) => ({
      layer,
      total: rows.length,
      on: rows.filter((r) => r.on).length,
      rows,
    }));
}

export interface WorkbenchCounts {
  readonly total: number;
  readonly on: number;
  readonly autoDisabled: number;
}

export function countsOf(s: WorkbenchState): WorkbenchCounts {
  return {
    total: s.entries.length,
    on: s.entries.filter(isOn).length,
    autoDisabled: s.entries.filter((e) => e.autoDisabled).length,
  };
}

export function selectedEntry(s: WorkbenchState): ExtListEntry | null {
  const name = s.detail ?? s.selected;
  return name === null ? null : (s.entries.find((e) => e.name === name) ?? null);
}

// ───────── 켜기·끄기(전역, 15-1) ─────────

/** 켜기·끄기가 보내는 설정 쓰기. 범위는 항상 `user`다(크래프트에서 범위 고르기를 뺌) */
export interface ToggleRequest {
  readonly key: string;
  readonly value: boolean;
  readonly scope: "user";
}

export type ToggleRefusal = "locked" | "unknown";

/** 스위치를 `target`으로 돌리는 요청. 잠긴 행(면제 tier, 안전 모드 제외, managed)은 보내지 않는다 */
export function toggleRequestOf(
  s: WorkbenchState,
  name: string,
  target: boolean,
):
  | { readonly ok: true; readonly request: ToggleRequest }
  | { readonly ok: false; readonly reason: ToggleRefusal } {
  const entry = s.entries.find((e) => e.name === name);
  if (entry === undefined) return { ok: false, reason: "unknown" };
  if (lockOf(entry) !== null) return { ok: false, reason: "locked" };
  return { ok: true, request: { key: `ext.${name}.enabled`, value: target, scope: "user" } };
}

// ───────── 버전 탭(§6.24.1, 전체 단계) ─────────

export interface VersionRowVM {
  readonly version: string;
  readonly installedAt: string;
  readonly source: "bundled" | "user" | "authored";
  readonly current: boolean;
  /** 되돌릴 수 있는 행: 지금 판이 아니다 */
  readonly canRollback: boolean;
  /** 대상 판의 상태 스키마가 지금 판보다 높거나 알 수 없으면 "상태를 비우고 되돌리기"만 허용 */
  readonly needsClearState: boolean;
}

export function versionRows(result: ExtVersionsResult): readonly VersionRowVM[] {
  const current = result.versions.find((v) => v.current);
  const currentSchema = current === undefined ? null : current.stateSchemaVersion;
  return result.versions.map((v) => ({
    version: v.version,
    installedAt: v.installedAt,
    source: v.source,
    current: v.current,
    canRollback: !v.current,
    needsClearState:
      !v.current &&
      v.stateSchemaVersion !== null &&
      (currentSchema === null || v.stateSchemaVersion > currentSchema),
  }));
}
