// 훅별 핸들러 순서 덮어쓰기: 설정 값 읽기·쓰기, 적용 상태, 제안 검사, 미리보기. 대부분 순수 함수다.
import { err, ok, type Result } from "@fresnel/contracts";
import {
  CHAIN_RULES,
  HOOKS,
  HOOK_NAMES,
  type ChainHookName,
  type ExtensionName,
  type HookName,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import { isPinnedTier, orderEntries } from "../primitives/order.ts";

/** 훅 이름 → Registration id 목록(앞이 먼저 실행된다). 고정 tier 핸들러 id는 들어가지 않는다 */
export type HookOrderMap = ReadonlyMap<HookName, readonly RegistrationId[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** 처음 나온 순서를 지키며 중복을 뺀다 */
function uniq(ids: readonly string[]): RegistrationId[] {
  return [...new Set(ids)];
}

/** 설정 값(`{ "<hook>": ["<registrationId>", ...] }`)을 읽는다. 훅 이름이 아닌 키, 배열이 아닌 값, 문자열이 아닌 원소, 중복은 버린다(저장된 값이 손상돼도 디스패치가 멈추지 않는다). 빈 목록은 뺀다 */
export function hookOrderOf(value: unknown): HookOrderMap {
  const map = new Map<HookName, readonly RegistrationId[]>();
  if (!isRecord(value)) return map;
  for (const [key, list] of Object.entries(value)) {
    const hook = HOOK_NAMES.find((name) => name === key);
    if (hook === undefined || !isList(list)) continue;
    const ids = uniq(list.filter(isString));
    if (ids.length > 0) map.set(hook, ids);
  }
  return map;
}

/** HookOrderMap을 설정 값(JSON 객체)으로 */
export function hookOrderValue(map: HookOrderMap): Record<string, string[]> {
  return Object.fromEntries([...map].map(([hook, ids]): [string, string[]] => [hook, [...ids]]));
}

function copyOf(map: HookOrderMap): HookOrderMap {
  return new Map<HookName, readonly RegistrationId[]>(
    [...map].map(([hook, ids]): [HookName, readonly RegistrationId[]] => [hook, [...ids]]),
  );
}

function sameMap(a: HookOrderMap, b: HookOrderMap): boolean {
  if (a.size !== b.size) return false;
  for (const [hook, ids] of a) {
    const other = b.get(hook);
    if (other === undefined || other.length !== ids.length) return false;
    if (ids.some((id, index) => id !== other[index])) return false;
  }
  return true;
}

export interface HookOrderState {
  /** 지금 적용 중인 순서. 처음 부를 때 한 번 원천에서 읽는다 */
  applied(point: HookName): readonly RegistrationId[] | undefined;
  appliedMap(): HookOrderMap;
  /** 원천(저장된 설정)의 현재 값. 아직 적용되지 않았을 수 있다 */
  saved(): HookOrderMap;
  /** 저장된 값과 적용 중인 값이 다른가 */
  pending(): boolean;
  /** 보류 중인 값을 적용한다. 바뀌었으면 true. 단계 경계에서 부른다 */
  applyPending(): boolean;
}

/** 적용 상태를 든다. 저장 값이 바뀌어도 단계 경계(applyPending)까지는 적용 중인 값을 그대로 쓴다 */
export function createHookOrderState(read: () => HookOrderMap): HookOrderState {
  let active: HookOrderMap | undefined;
  function current(): HookOrderMap {
    if (active === undefined) active = copyOf(read());
    return active;
  }
  return {
    applied: (point) => current().get(point),
    appliedMap: () => current(),
    saved: () => copyOf(read()),
    pending: () => !sameMap(current(), copyOf(read())),
    applyPending() {
      const next = copyOf(read());
      if (sameMap(current(), next)) return false;
      active = next;
      return true;
    },
  };
}

export interface OrderRow {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  readonly tier: number;
}

export type OrderCheckError =
  /** 고정(guard) 핸들러를 현재 상대 순서와 다르게 놓으려 했다 */
  | {
      readonly kind: "guard_moved";
      readonly hook: HookName;
      readonly registrationId: RegistrationId;
    }
  /** 고정 핸들러 위에 다른 핸들러를 놓으려 했다: registrationId는 고정 핸들러, above는 그 앞에 놓인 일반 핸들러 */
  | {
      readonly kind: "above_guard";
      readonly hook: HookName;
      readonly registrationId: RegistrationId;
      readonly above: RegistrationId;
    };

/** 고정 핸들러 id → 고정 행끼리의 상대 순서(current 기준). current는 디스패치 순서다 */
function pinnedRanksOf(current: readonly OrderRow[]): ReadonlyMap<RegistrationId, number> {
  const ranks = new Map<RegistrationId, number>();
  for (const row of current) {
    if (isPinnedTier(row.tier) && !ranks.has(row.registrationId)) {
      ranks.set(row.registrationId, ranks.size);
    }
  }
  return ranks;
}

/** 저장할 목록: 고정 핸들러 id를 뺀 중복 없는 목록. 순서는 제안의 첫 출현 순서다 */
function withoutPinned(
  proposal: readonly string[],
  pinned: ReadonlyMap<RegistrationId, number>,
): RegistrationId[] {
  return uniq(proposal).filter((id) => !pinned.has(id));
}

/**
 * 제안한 순서를 검사하고 저장할 값(고정 핸들러를 뺀 중복 없는 목록)을 돌려준다.
 * 제안이 고정 핸들러 id를 포함하면 그것들이 제안 안에서 모든 일반 핸들러보다 앞이고 current의 상대 순서와 같을 때만 받는다.
 * 고정 핸들러 id를 아예 안 적는 것은 괜찮다. 알 수 없는 id(current에 없는 id)는 오류가 아니고 그대로 저장한다.
 */
export function checkOrder(
  hook: HookName,
  proposal: readonly string[],
  current: readonly OrderRow[],
): Result<readonly RegistrationId[], OrderCheckError> {
  const pinned = pinnedRanksOf(current);
  const ids = uniq(proposal);
  // 고정 핸들러가 처음 본 일반 핸들러 뒤에 오면 안 된다. 뒤에 오는 고정 핸들러마다 첫 일반 핸들러를 알린다
  let firstFree: RegistrationId | undefined;
  for (const id of ids) {
    if (!pinned.has(id)) {
      firstFree ??= id;
    } else if (firstFree !== undefined) {
      return err({ kind: "above_guard", hook, registrationId: id, above: firstFree });
    }
  }
  // 제안 안의 고정 핸들러(중복 뺌)가 현재 상대 순서를 지켜야 한다. 순서가 깨지는 첫 고정 핸들러를 알린다
  let lastRank = -1;
  for (const id of ids) {
    const rank = pinned.get(id);
    if (rank === undefined) continue;
    if (rank < lastRank) return err({ kind: "guard_moved", hook, registrationId: id });
    lastRank = rank;
  }
  return ok(withoutPinned(ids, pinned));
}

/** 미리보기 입력 행. exempt는 자동 끄기에서 빠지는지(guard, core tier, essential) */
export interface PreviewRow extends OrderRow {
  readonly exempt: boolean;
}

export interface PreviewRef {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  readonly tier: number;
}

export type SkipReason = "first_answer" | "first_failure_deny" | "chain_stop";

export interface SkipNote {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  readonly reason: SkipReason;
  readonly by: readonly PreviewRef[];
}

export interface ValueChangeNote {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  readonly by: readonly PreviewRef[];
}

export interface AutoDisableNote {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  readonly affects: readonly PreviewRef[];
}

export interface OrderPreview {
  readonly hook: HookName;
  /** 이 제안을 적용했을 때의 전체 순서(고정 핸들러가 항상 앞) */
  readonly order: readonly RegistrationId[];
  readonly skips: readonly SkipNote[];
  readonly valueChanges: readonly ValueChangeNote[];
  readonly autoDisable: readonly AutoDisableNote[];
  /** 저장을 막는 유일한 사유. 없으면 null. 미리보기는 이 경우에도 고정 핸들러 이름을 뺀 제안으로 계산해 돌려준다 */
  readonly guard: OrderCheckError | null;
}

function refOf(row: OrderRow): PreviewRef {
  return { registrationId: row.registrationId, extension: row.extension, tier: row.tier };
}

function isChainHook(hook: HookName): hook is ChainHookName {
  return HOOKS[hook].fold === "chain";
}

/**
 * 제안을 적용했을 때 생기는 일을 미리 보여 준다. 훅 종류(fold)와 실패 정책(failure)으로 노트를 만든다.
 * - first: 앞선 핸들러가 결정하면 뒤 핸들러는 건너뛴다(first_answer). closed 훅은 앞선 핸들러가 실패하면 거부로 멈춘다(first_failure_deny).
 * - chain: 뒤 핸들러의 패치가 앞선 핸들러가 낸 값을 바꿀 수 있다(valueChanges). 멈춤 규칙이 있으면 뒤 핸들러를 건너뛴다(chain_stop).
 * - tap, collect: 모든 핸들러가 돈다. 노트가 없다.
 * - 자동 끄기: closed first 훅에서 면제되지 않은 핸들러가 실패하면 뒤 핸들러 전부가 막힌다(affects).
 */
export function previewOrder(
  hook: HookName,
  proposal: readonly string[],
  current: readonly PreviewRow[],
): OrderPreview {
  const checked = checkOrder(hook, proposal, current);
  const guard = checked.ok ? null : checked.error;
  const normalized = checked.ok ? checked.value : withoutPinned(proposal, pinnedRanksOf(current));
  const rows = orderEntries(
    current.map((row) => ({ ...row, scopeId: row.registrationId })),
    (row) => row.tier,
    normalized,
  );

  const fold = HOOKS[hook].fold;
  const closed = fold === "first" && HOOKS[hook].failure === "closed";
  const chainStop = isChainHook(hook) && CHAIN_RULES[hook].stop !== undefined;
  const skips: SkipNote[] = [];
  const valueChanges: ValueChangeNote[] = [];
  const autoDisable: AutoDisableNote[] = [];
  for (const [index, row] of rows.entries()) {
    const earlier = rows.slice(0, index).map(refOf);
    const later = rows.slice(index + 1).map(refOf);
    const base = { registrationId: row.registrationId, extension: row.extension };
    if (earlier.length > 0) {
      if (fold === "first") {
        skips.push({ ...base, reason: "first_answer", by: earlier });
        if (closed) skips.push({ ...base, reason: "first_failure_deny", by: earlier });
      }
      if (fold === "chain") {
        valueChanges.push({ ...base, by: earlier });
        if (chainStop) skips.push({ ...base, reason: "chain_stop", by: earlier });
      }
    }
    if (closed && !row.exempt && later.length > 0) {
      autoDisable.push({ ...base, affects: later });
    }
  }

  return {
    hook,
    order: uniq(rows.map((row) => row.registrationId)),
    skips,
    valueChanges,
    autoDisable,
    guard,
  };
}
