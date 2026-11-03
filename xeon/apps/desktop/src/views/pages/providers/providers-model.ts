import {
  DEFAULT_RATE_LIMIT_POLICY,
  ROTATION_ACK_KEY,
  type AccountEntry,
  type RateLimitEntry,
  type UsageLimitAction,
} from "@fresnel/client";
import type { FieldVM } from "@fresnel/client/settings";
import type { UsageGauge } from "@fresnel/contracts/wire";

// 계정과 제공자, 예산과 한도 화면(P-11)의 순수 모델. 계정 풀, 레이트 리밋, 모델 역할, 대체 사슬의 값을 읽고 고친다.
// 값의 검사와 모양은 client(`accounts`, `settings`)가 맡고, 여기서는 화면이 쓰는 묶기와 순서만 한다.
// 쓰기는 항목마다 `settings.set` 한 번이다(P-09 초안 흐름). 계정 파일 한 번 쓰기(`saveModelAccounts`)는 쓰지 않는다.

/** 계정이 이만큼 넘는 provider는 접는다(L4.desktop-ux §6.15 긴 내용) */
export const ACCOUNT_FOLD_MAX = 20;
/** 끌거나 키로 옮긴 뒤 우선순위 간격 [제안] */
const PRIORITY_STEP = 10;
/** 역할마다 대체 모델은 최대 세 개다(`l1.models.fallbackChains`) */
export const FALLBACK_MAX = 3;
/** 모델 역할 여섯 개(L1.models §3.4). 화면 순서대로 */
export const ROLE_IDS = ["main", "review", "summary", "subagent", "judge", "search"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ON_LIMIT_ACTIONS: readonly UsageLimitAction[] = ["wait", "switch", "fail"];

/** provider id 형식(`l1.models.accounts`와 `l1.models.rateLimit`의 키). client의 패턴과 같다 */
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isProviderId(text: string): boolean {
  return PROVIDER_ID.test(text);
}

export interface ProviderPool {
  readonly provider: string;
  /** 우선순위 오름차순. 같으면 설정 순서다 */
  readonly accounts: readonly AccountEntry[];
}

/** 계정 목록을 provider별로 묶는다. provider는 id 순서다 */
export function poolsOf(list: readonly AccountEntry[]): readonly ProviderPool[] {
  const providers = [...new Set(list.map((entry) => entry.provider))].toSorted();
  return providers.map((provider) => ({
    provider,
    accounts: list
      .filter((entry) => entry.provider === provider)
      .toSorted((a, b) => a.priority - b.priority),
  }));
}

/** 접힌 목록에서 보일 계정 수와 숨은 수. 펼치면 전부 보인다 */
export function foldOf<T>(
  items: readonly T[],
  expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (expanded || items.length <= ACCOUNT_FOLD_MAX) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, ACCOUNT_FOLD_MAX), hidden: items.length - ACCOUNT_FOLD_MAX };
}

/**
 * provider 안에서 계정 순서를 `orderedIds`(계정 id 순서)대로 바꾼다. 같은 provider의 계정은 `PRIORITY_STEP` 간격으로 다시 매긴다.
 * 다른 provider의 계정은 그대로다.
 */
export function reprioritizedOf(
  list: readonly AccountEntry[],
  provider: string,
  orderedIds: readonly string[],
): readonly AccountEntry[] {
  return list.map((entry) => {
    if (entry.provider !== provider) return entry;
    const index = orderedIds.indexOf(entry.accountId);
    return index === -1 ? entry : { ...entry, priority: index * PRIORITY_STEP };
  });
}

/** 레이트 리밋 표의 한 줄. 정책이 있는 provider만 든다 */
export interface RateRow {
  readonly provider: string;
  readonly policy: RateLimitEntry;
}

export function rateRowsOf(map: Readonly<Record<string, RateLimitEntry>>): readonly RateRow[] {
  return Object.keys(map)
    .toSorted()
    .map((provider) => ({ provider, policy: map[provider] ?? DEFAULT_RATE_LIMIT_POLICY }));
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 역할 → 모델 참조 맵(`l1.models.routing.*`을 한 값으로 묶은 모양). 글이 아닌 값이 있으면 `null`이다 */
export type RoleRefs = Readonly<Record<string, string>>;

export function roleRefsOf(value: unknown): RoleRefs | null {
  if (!isObject(value)) return null;
  const out: Record<string, string> = {};
  for (const [role, ref] of Object.entries(value)) {
    if (typeof ref !== "string") return null;
    out[role] = ref;
  }
  return out;
}

/** 역할의 참조를 바꾼다. `null`이면 그 역할을 지운다(기본 모델을 쓴다) */
export function withRoleRef(refs: RoleRefs, role: string, ref: string | null): RoleRefs {
  const next: Record<string, string> = { ...refs };
  if (ref === null) delete next[role];
  else next[role] = ref;
  return next;
}

/** 역할 → 대체 모델 목록 맵(`l1.models.fallbackChains`). 목록이 아니거나 글이 아닌 원소가 있으면 `null`이다 */
export type ChainMap = Readonly<Record<string, readonly string[]>>;

export function chainsOf(value: unknown): ChainMap | null {
  if (!isObject(value)) return null;
  const out: Record<string, readonly string[]> = {};
  for (const [role, list] of Object.entries(value)) {
    if (!Array.isArray(list)) return null;
    const items: string[] = [];
    for (const item of list) {
      if (typeof item !== "string") return null;
      items.push(item);
    }
    out[role] = items;
  }
  return out;
}

/** 역할의 대체 목록을 바꾼다. 빈 목록이면 그 역할을 지운다 */
export function withChain(chains: ChainMap, role: string, items: readonly string[]): ChainMap {
  const next: Record<string, readonly string[]> = { ...chains };
  if (items.length === 0) delete next[role];
  else next[role] = items;
  return next;
}

// ── 계정 회전 행 ─────────────────────────────────────────────────────────

/** 계정 회전 플러그인의 켜기 키(X 로더 예약 키 `enabled`, 기본 꺼짐). 고지 동의 키는 client `ROTATION_ACK_KEY`다 */
export const ROTATION_ENABLED_KEY = "ext.account-rotation.enabled";

/** 설정 키 하나에 쓸 값. 바뀌는 키만 담는다 */
export interface RotationWrite {
  readonly key: string;
  readonly value: boolean;
}

/** 회전 스위치를 바꾼 결과: 위험 확인 대화 상자를 먼저 열거나, 바로 쓴다 */
export type RotationStep =
  | { readonly kind: "ask" }
  | { readonly kind: "write"; readonly writes: readonly RotationWrite[] };

/**
 * 스위치를 `next`로 바꿨을 때의 행동(L4.desktop-ux §6.15). 끄면 켜기 키만 `false`로 쓴다.
 * 켜는 쪽은 고지에 동의하지 않았으면 위험 확인 대화 상자를 먼저 연다. 동의했으면 켜기 키만 쓰고, 이미 켜져 있으면 아무것도 쓰지 않는다.
 */
export function rotationStepOf(
  input: { readonly pluginEnabled: boolean; readonly acknowledged: boolean },
  next: boolean,
): RotationStep {
  if (!next) {
    return {
      kind: "write",
      writes: input.pluginEnabled ? [{ key: ROTATION_ENABLED_KEY, value: false }] : [],
    };
  }
  if (!input.acknowledged) return { kind: "ask" };
  return {
    kind: "write",
    writes: input.pluginEnabled ? [] : [{ key: ROTATION_ENABLED_KEY, value: true }],
  };
}

/**
 * 위험 확인 대화 상자의 "위험을 알고 켜기"가 쓰는 값. 동의 키를 먼저 쓰고, 플러그인이 꺼져 있었으면 켜기 키를 잇는다.
 */
export function rotationConfirmOf(input: {
  readonly pluginEnabled: boolean;
}): readonly RotationWrite[] {
  return [
    { key: ROTATION_ACK_KEY, value: true },
    ...(input.pluginEnabled ? [] : [{ key: ROTATION_ENABLED_KEY, value: true }]),
  ];
}

/** 키 이름으로 설정 항목을 찾는다. 탭에 없으면 `undefined`다 */
export function fieldOfKey<F extends Pick<FieldVM, "key">>(
  fields: readonly F[],
  key: string,
): F | undefined {
  return fields.find((field) => field.key === key);
}

// ── 사용량 게이지 ────────────────────────────────────────────────────────

/**
 * 게이지의 채움 비율(0~100). 한도를 모르거나 한도가 0 이하이면 `null`이다. 비율을 지어내지 않는다(caustic `Progress`는 모르면 indeterminate).
 */
export function usageFractionOf(gauge: UsageGauge): number | null {
  if (gauge.limit === null || gauge.limit <= 0) return null;
  return Math.min(100, (gauge.used / gauge.limit) * 100);
}
