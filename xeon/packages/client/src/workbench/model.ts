import { assertNever } from "@fresnel/contracts";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  ExtVersionsResult,
} from "@fresnel/contracts/wire";
import { clearSel, selectGroup, selectPlugin } from "./canvas/select.ts";
import type { Contrib, KindFilter, LayerKey, Sel } from "./canvas/types.ts";

// 크래프트(LightCraft, 코드 id `workbench`) 공유 상태의 순수 모델. spec L4.desktop-ux §6.21~§6.24.
// 크래프트는 전역 상태만 다룬다(2026-11-03 (4)): 범위와 맥락 칸이 없고, 켜기·끄기는 사용자 범위(`user`) 값 하나다.
// 그룹은 스위치 하나다(15-1). 지도·순서·링크(T-CANVAS)와 선택 패널·층 패널·자세히 보기(T-BENCH)가 같은 값을 읽는다.
// 선택(`sel`)과 거르기(`kind`, `contrib`)의 값 종류는 canvas/types.ts가 정한다. 이 파일은 canvas를 import하지 않는다.
// 스토어(zustand)는 앱의 `state/workbench`가 이 파일의 함수로 감싼다.

/** 개요의 보기 셋. 기본은 지도 */
export const WORKBENCH_VIEWS = ["orbit", "strata", "link"] as const;
export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

export type ListStatus = "idle" | "loading" | "ready" | "error";

export interface WorkbenchState {
  readonly list: ListStatus;
  /** `ext.list` 결과(이름순이 아니라 호스트가 준 순서) */
  readonly entries: readonly ExtListEntry[];
  readonly view: WorkbenchView;
  /** 캔버스 선택. 지도·순서·선택 패널이 같은 값을 읽는다 */
  readonly sel: Sel;
  /** 선택 패널이 열렸나 */
  readonly panel: boolean;
  /** 자세히 보기로 열린 플러그인 또는 그룹 id(루트는 확장 이름, 구성원은 "<확장>/<id>"). 있으면 캔버스 전체가 그 하나로 바뀐다 */
  readonly detail: string | null;
  readonly query: string;
  /** 지도 거르기: 플러그인 종류 */
  readonly kind: KindFilter;
  /** 지도 거르기: 무엇을 넣어 주나. 고른 것만 담는다 */
  readonly contrib: readonly Contrib[];
  /** `ext.get` 캐시. 확장 이름 → 매니페스트·훅·기능 엣지 */
  readonly details: Readonly<Record<string, ExtGetResult>>;
  /** `ext.health` 캐시. 등록 id(registrationId) → 실패 장부 */
  readonly health: Readonly<Record<string, ExtHealthEntry>>;
  /** 훅 → 적용 중인 Registration id 순서(`hooks.order.get`의 applied) */
  readonly order: Readonly<Record<string, readonly string[]>>;
  /** 켜기·끄기 요청이 아직 반영되지 않은 확장 이름과 목표 값 */
  readonly pending: Readonly<Record<string, boolean>>;
  /** 빌더를 열라는 요청(15-3). `hook`은 순서 보기 훅 줄의 `추가`가 고른 훅 이름, 없으면 훅 없이 연다. 빌더 화면(T-AUTH)이 읽고 `closeBuilder`로 비운다 */
  readonly builder: { readonly hook: string | null } | null;
}

export const INITIAL_WORKBENCH: WorkbenchState = {
  list: "idle",
  entries: [],
  view: "orbit",
  ...clearSel(),
  detail: null,
  query: "",
  kind: "all",
  contrib: [],
  details: {},
  health: {},
  order: {},
  pending: {},
  builder: null,
};

/** 등록 id의 확장 이름. 루트 플러그인은 id가 곧 이름이고, 구성원은 "<확장>/<id>"다 */
export function extOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/** 고른 것이 플러그인이나 그룹이면 그 id, 아니면 null */
function selectedId(sel: Sel): string | null {
  return sel.k === "plugin" || sel.k === "group" ? sel.id : null;
}

export function listLoading(s: WorkbenchState): WorkbenchState {
  return { ...s, list: "loading" };
}

export function listFailed(s: WorkbenchState): WorkbenchState {
  return { ...s, list: "error" };
}

/** 목록이 들어오면 사라진 확장을 가리키는 선택·자세히 보기·캐시·반영된 대기 표시를 걷어 낸다 */
export function listLoaded(s: WorkbenchState, entries: readonly ExtListEntry[]): WorkbenchState {
  const names = new Set(entries.map((e) => e.name));
  const gone = (id: string): boolean => !names.has(extOf(id));
  const pending: Record<string, boolean> = {};
  for (const [name, target] of Object.entries(s.pending)) {
    const entry = entries.find((e) => e.name === name);
    if (entry !== undefined && isOn(entry) !== target) pending[name] = target;
  }
  const selId = selectedId(s.sel);
  const keep = selId !== null && gone(selId) ? clearSel() : { sel: s.sel, panel: s.panel };
  return {
    ...s,
    list: "ready",
    entries,
    ...keep,
    detail: s.detail !== null && !gone(s.detail) ? s.detail : null,
    details: Object.fromEntries(Object.entries(s.details).filter(([name]) => names.has(name))),
    pending,
  };
}

export function setView(s: WorkbenchState, view: WorkbenchView): WorkbenchState {
  return { ...s, view, detail: null };
}

/** 플러그인 하나를 고르고 선택 패널을 연다 */
export function pickPlugin(s: WorkbenchState, id: string): WorkbenchState {
  return { ...s, ...selectPlugin(id) };
}

/** 그룹을 고르고 선택 패널을 연다 */
export function pickGroup(s: WorkbenchState, id: string): WorkbenchState {
  return { ...s, ...selectGroup(id) };
}

/** 임의의 선택(층, 훅 줄, 내장 슬롯 포함)을 고르고 선택 패널을 연다 */
export function pickSel(s: WorkbenchState, sel: Sel): WorkbenchState {
  return { ...s, sel, panel: true };
}

/** 선택을 비운다(에이전트, 패널 닫힘) */
export function clearPick(s: WorkbenchState): WorkbenchState {
  return { ...s, ...clearSel() };
}

/** 옛 이름 호환: 이름이 있으면 플러그인으로 고르고, 없으면 비운다 */
export function select(s: WorkbenchState, name: string | null): WorkbenchState {
  return name === null ? clearPick(s) : pickPlugin(s, name);
}

/** 자세히 보기를 연다. 선택은 바꾸지 않는다(필요하면 먼저 `pickPlugin`·`pickGroup`) */
export function openDetail(s: WorkbenchState, id: string): WorkbenchState {
  return { ...s, detail: id };
}

export function closeDetail(s: WorkbenchState): WorkbenchState {
  return { ...s, detail: null };
}

export function requestBuilder(s: WorkbenchState, hook: string | null): WorkbenchState {
  return { ...s, builder: { hook } };
}

export function closeBuilder(s: WorkbenchState): WorkbenchState {
  return { ...s, builder: null };
}

export function setQuery(s: WorkbenchState, query: string): WorkbenchState {
  return { ...s, query };
}

export function setKind(s: WorkbenchState, kind: KindFilter): WorkbenchState {
  return { ...s, kind };
}

/** 무엇을 넣어 주나 거르기를 토글한다: 있으면 빼고 없으면 더한다 */
export function toggleContrib(s: WorkbenchState, c: Contrib): WorkbenchState {
  const contrib = s.contrib.includes(c) ? s.contrib.filter((x) => x !== c) : [...s.contrib, c];
  return { ...s, contrib };
}

/** `ext.get` 결과를 확장 이름 아래에 넣는다 */
export function detailsLoaded(
  s: WorkbenchState,
  name: string,
  result: ExtGetResult,
): WorkbenchState {
  return { ...s, details: { ...s.details, [name]: result } };
}

/** `ext.health` 결과로 실패 장부 전체를 바꾼다(등록 id별) */
export function healthLoaded(
  s: WorkbenchState,
  entries: readonly ExtHealthEntry[],
): WorkbenchState {
  const health = Object.fromEntries(
    entries.map((e): [string, ExtHealthEntry] => [e.registrationId, e]),
  );
  return { ...s, health };
}

/** `hooks.order.get`의 적용 순서로 훅별 순서 표를 바꾼다 */
export function ordersLoaded(
  s: WorkbenchState,
  order: Readonly<Record<string, readonly string[]>>,
): WorkbenchState {
  return { ...s, order };
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

/** 선택 패널·자세히 보기가 다루는 확장. 자세히 보기가 열려 있으면 그쪽을 본다 */
export function selectedEntry(s: WorkbenchState): ExtListEntry | null {
  const id = s.detail ?? selectedId(s.sel);
  if (id === null) return null;
  const name = extOf(id);
  return s.entries.find((e) => e.name === name) ?? null;
}

/** 고른 플러그인·그룹의 확장 이름(자세히 보기는 보지 않는다). 지도·층 목록의 강조에 쓴다 */
export function selectedName(s: WorkbenchState): string | null {
  const id = selectedId(s.sel);
  return id === null ? null : extOf(id);
}

/** 층 선택이면 그 층, 아니면 null. 층 목록이 이 층만 보인다 */
export function openLayerOf(s: WorkbenchState): LayerKey | null {
  return s.sel.k === "layer" ? s.sel.id : null;
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

/** `ext.versions` 읽기의 결과. 기록을 읽었거나, 이 엔진이 기록 읽기를 지원하지 않거나(`unsupported`), 읽기가 실패했다 */
export type VersionsLoad =
  | { readonly kind: "ready"; readonly result: ExtVersionsResult }
  | { readonly kind: "unsupported" }
  | { readonly kind: "error" };

/**
 * 버전 탭이 그릴 것(§6.24.1). 기록이 있으면 전체(`history`), 기록이 없거나 읽기를 지원하지 않으면 대체(`fallback`).
 * 대체는 설치본 버전과 앱에 든 번들 버전만 보인다. 되돌리기 명령은 wire가 없어 대체에 두지 않는다.
 */
export type VersionsView =
  | { readonly kind: "history"; readonly rows: readonly VersionRowVM[] }
  | {
      readonly kind: "fallback";
      /** 설치본 버전 */
      readonly installed: string;
      /** 앱에 든 번들 버전. 기본(builtin) 플러그인만 있고 그 밖의 확장은 null이다 */
      readonly bundled: string | null;
    }
  | { readonly kind: "error" };

function fallbackOf(entry: Pick<ExtListEntry, "version" | "origin">): VersionsView {
  return {
    kind: "fallback",
    installed: entry.version,
    // 기본 플러그인은 설치 폴더 없이 앱에 든 판이 곧 설치본이다(호스트는 버전 기록을 두지 않는다)
    bundled: entry.origin === "builtin" ? entry.version : null,
  };
}

/** 버전 탭의 그림을 고른다. 기록이 비었거나 지원하지 않으면 대체, 읽기 실패는 오류 한 줄이다 */
export function versionsViewOf(
  entry: Pick<ExtListEntry, "version" | "origin">,
  load: VersionsLoad,
): VersionsView {
  switch (load.kind) {
    case "ready": {
      const rows = versionRows(load.result);
      return rows.length === 0 ? fallbackOf(entry) : { kind: "history", rows };
    }
    case "unsupported":
      return fallbackOf(entry);
    case "error":
      return { kind: "error" };
    default:
      return assertNever(load, "VersionsLoad");
  }
}

// ───────── 기록 탭(§6.24 "기록", `scope.handler_failed`) ─────────

/** 확장 핸들러 실패 기록 한 건의 읽을 값(엔진 거울이 받은 것). owner는 "ext:<이름>" 또는 "hook:<이름>"이다 */
export interface HandlerFailureEntry {
  readonly owner: string;
  readonly point: string;
  readonly result: string;
  readonly message: string;
  readonly consecutive: number;
}

/** 기록 탭의 한 행: 같은 훅·결과·메시지의 실패 묶음 */
export interface FailureRowVM {
  /** 훅 이름(`point`) */
  readonly point: string;
  readonly result: string;
  readonly message: string;
  /** 묶인 기록 수 */
  readonly count: number;
  /** 가장 나중 기록의 연속 실패 수 */
  readonly consecutive: number;
}

/**
 * 확장 하나(`name`)의 실패 기록을 묶는다. 같은 (훅, 결과, 메시지)는 한 행이고, 행의 횟수는 기록 수, 연속 값은 가장 나중 기록의 값이다.
 * 가장 최근에 난 행이 위에 온다. `records`는 받은 순서(오래된 것 먼저)다.
 */
export function failureRowsOf(
  records: readonly HandlerFailureEntry[],
  name: string,
): readonly FailureRowVM[] {
  return failureRowsOfOwner(records, `ext:${name}`);
}

/** owner 하나(`ext:<이름>`이나 `hook:<이름>`)의 실패 기록을 묶는다. `failureRowsOf`와 런타임 탭의 실패 구역이 쓴다 */
export function failureRowsOfOwner(
  records: readonly HandlerFailureEntry[],
  owner: string,
): readonly FailureRowVM[] {
  const byKey = new Map<string, { row: FailureRowVM; last: number }>();
  records.forEach((r, index) => {
    if (r.owner !== owner) return;
    const key = `${r.point}\u0000${r.result}\u0000${r.message}`;
    const found = byKey.get(key);
    if (found === undefined) {
      byKey.set(key, {
        row: {
          point: r.point,
          result: r.result,
          message: r.message,
          count: 1,
          consecutive: r.consecutive,
        },
        last: index,
      });
    } else {
      byKey.set(key, {
        row: { ...found.row, count: found.row.count + 1, consecutive: r.consecutive },
        last: index,
      });
    }
  });
  return [...byKey.values()].toSorted((a, b) => b.last - a.last).map((v) => v.row);
}
