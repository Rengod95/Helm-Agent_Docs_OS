// 훅별 핸들러 순서 덮어쓰기: 설정 값 읽기·쓰기, 적용 상태, 제안 검사, 미리보기. 대부분 순수 함수다.
import {
  CHAIN_RULES,
  HOOKS,
  HOOK_NAMES,
  type ChainHookName,
  type ExtensionName,
  type HookName,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import { orderEntries } from "../primitives/order.ts";
import { TIERS } from "./tier.ts";

/** guard tier의 순위(0). 미리보기가 guard 핸들러를 알아보는 데만 쓴다. 순서를 고정하지 않는다 */
const GUARD_RANK = TIERS.indexOf("guard");

/** 훅 이름 → Registration id 목록(앞이 먼저 실행된다) */
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
  /** 지금 적용 중인 순서. 만들 때와 start에서 원천을 읽어 정한다 */
  applied(point: HookName): readonly RegistrationId[] | undefined;
  appliedMap(): HookOrderMap;
  /** 원천(저장된 설정)의 현재 값. 아직 적용되지 않았을 수 있다 */
  saved(): HookOrderMap;
  /** 저장된 값과 적용 중인 값이 다른가 */
  pending(): boolean;
  /** 저장된 값을 지금 적용 중인 값으로 든다. 조립이 설정 파일을 읽은 뒤 한 번 부른다(단계 경계를 기다리지 않는다) */
  start(): void;
  /** 보류 중인 값을 적용한다. 바뀌었으면 true. 단계 경계에서 부른다 */
  applyPending(): boolean;
}

/**
 * 적용 상태를 든다. 만들 때 원천을 읽어 적용 중인 값으로 삼는다. 이후 저장 값이 바뀌어도 단계 경계(applyPending)까지는
 * 적용 중인 값을 그대로 쓴다. 만든 시점에 설정 파일이 아직 안 읽혔을 수 있으므로(조립 순서) 조립은 설정을 읽은 뒤 start를 부른다.
 */
export function createHookOrderState(read: () => HookOrderMap): HookOrderState {
  let active: HookOrderMap = copyOf(read());
  return {
    applied: (point) => active.get(point),
    appliedMap: () => active,
    saved: () => copyOf(read()),
    pending: () => !sameMap(active, copyOf(read())),
    start() {
      active = copyOf(read());
    },
    applyPending() {
      const next = copyOf(read());
      if (sameMap(active, next)) return false;
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

/**
 * 제안한 순서를 저장할 값으로 고친다: 중복을 뺀 목록이고 제안의 첫 출현 순서를 지킨다. 거부하지 않는다.
 * guard tier 핸들러도 옮길 수 있다(2026-11-03 사용자 결정). 알 수 없는 id(없는 핸들러, 꺼진 핸들러)는 오류가 아니고 그대로 저장한다.
 * 저장을 막는 사유는 없다. 옮긴 guard가 건너뛰어질 수 있는 위험은 `previewOrder`의 `guardRisk`가 알린다.
 */
export function checkOrder(proposal: readonly string[]): RegistrationId[] {
  return uniq(proposal);
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

/**
 * guard tier 핸들러의 위험 노트. 제안을 적용하면 guard 핸들러가 건너뛰어지거나 맨 앞을 잃을 수 있다.
 * 저장은 막지 않는다. UI는 이 목록이 비어 있지 않으면 "안전 검사가 건너뛰어질 수 있다"는 강한 경고를 띄운다.
 */
export interface GuardRiskNote {
  readonly registrationId: RegistrationId;
  readonly extension: ExtensionName;
  /**
   * 제안이 앞에 둔 핸들러 때문에 이 훅에서 실행되지 않을 수 있다(first의 앞선 결정, closed first의 앞선 실패, chain의 멈춤).
   * 기본 순서에서 이미 앞이던 핸들러는 세지 않는다. skips에 같은 종류의 노트가 있다
   */
  readonly mayBeSkipped: boolean;
  /** 기본 순서에서 맨 앞이던 guard 핸들러가 이 제안에서 맨 앞을 잃었다 */
  readonly losesFirstPosition: boolean;
  /** 이 핸들러보다 앞에 놓인 핸들러 */
  readonly by: readonly PreviewRef[];
}

export interface OrderPreview {
  readonly hook: HookName;
  /** 이 제안을 적용했을 때의 전체 순서(덮어쓰기 적용 뒤) */
  readonly order: readonly RegistrationId[];
  readonly skips: readonly SkipNote[];
  readonly valueChanges: readonly ValueChangeNote[];
  readonly autoDisable: readonly AutoDisableNote[];
  /** guard 핸들러의 건너뜀과 맨 앞 상실. 없으면 빈 목록이다 */
  readonly guardRisk: readonly GuardRiskNote[];
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
 * - guard: guard tier 핸들러가 기본 순서에 없던 앞선 핸들러 때문에 건너뛰어지거나, 기본 순서에서 맨 앞이던 guard가 맨 앞을 잃으면
 *   guardRisk에 남긴다. 기본 순서에서 이미 뒤 guard가 앞 guard에게 가려지는 것은 위험으로 세지 않는다(제안이 만든 위험만 알린다).
 *   저장은 막지 않는다.
 * current는 기본 순서의 행이다(tier, loadIndex, seq). 제안은 이 순서 위에 얹힌다.
 */
export function previewOrder(
  hook: HookName,
  proposal: readonly string[],
  current: readonly PreviewRow[],
): OrderPreview {
  const rows = orderEntries(
    current.map((row) => ({ ...row, scopeId: row.registrationId })),
    checkOrder(proposal),
  );
  // 기본 순서에서의 자리(등록 id의 첫 출현). 제안이 앞으로 보낸 핸들러가 무엇인지 가린다
  const defaultPosOf = new Map<RegistrationId, number>();
  current.forEach((row, index) => {
    if (!defaultPosOf.has(row.registrationId)) defaultPosOf.set(row.registrationId, index);
  });
  const defaultPos = (id: RegistrationId): number =>
    defaultPosOf.get(id) ?? Number.MAX_SAFE_INTEGER;
  // 기본 순서에서 맨 앞인 행이 guard면 그 핸들러가 맨 앞을 가진다. 제안이 그 자리를 다른 핸들러에게 주면 맨 앞을 잃는다
  const defaultFirst = current[0];
  const guardFirst =
    defaultFirst !== undefined && defaultFirst.tier === GUARD_RANK
      ? defaultFirst.registrationId
      : undefined;
  const firstLost = guardFirst !== undefined && rows[0]?.registrationId !== guardFirst;

  const fold = HOOKS[hook].fold;
  const closed = fold === "first" && HOOKS[hook].failure === "closed";
  const chainStop = isChainHook(hook) && CHAIN_RULES[hook].stop !== undefined;
  const skips: SkipNote[] = [];
  const valueChanges: ValueChangeNote[] = [];
  const autoDisable: AutoDisableNote[] = [];
  const guardRisk: GuardRiskNote[] = [];
  for (const [index, row] of rows.entries()) {
    const earlierRows = rows.slice(0, index);
    const earlier = earlierRows.map(refOf);
    const later = rows.slice(index + 1).map(refOf);
    const base = { registrationId: row.registrationId, extension: row.extension };
    // 앞선 핸들러 때문에 실행되지 않을 수 있는가(skips와 같은 조건). 기본 순서에서 뒤에 있던 핸들러가 앞에 온 경우만 새 위험이다
    const mayBeSkipped =
      (fold === "first" || (fold === "chain" && chainStop)) &&
      earlierRows.some((prev) => defaultPos(prev.registrationId) > defaultPos(row.registrationId));
    const losesFirstPosition = firstLost && row.registrationId === guardFirst;
    if (row.tier === GUARD_RANK && (mayBeSkipped || losesFirstPosition)) {
      guardRisk.push({
        registrationId: row.registrationId,
        extension: row.extension,
        mayBeSkipped,
        losesFirstPosition,
        by: earlier,
      });
    }
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
    guardRisk,
  };
}
