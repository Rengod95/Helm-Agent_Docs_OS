import type { SecretRefString } from "@xeon/contracts/services";

// L1.models.spec §3.10, §4.8 (M3). 계정 풀과 레이트 리밋 상태기계다. 순수 로직이고 시계는 호출자가 now로 넘긴다.
// 상태(대기 종료 시각, 마지막 요청 시각, 사용률)는 프로세스 메모리에만 둔다.
// [미결] spec §4.8의 core_models_* 테이블 저장은 아직 연결하지 않는다(재시작하면 대기 상태가 사라진다).

/** l1.models.accounts의 원소 하나 */
export interface AccountDef {
  readonly provider: string;
  readonly accountId: string;
  /** `secret://<이름>` 참조. 값이 아니다 */
  readonly credential: SecretRefString;
  /** 작을수록 먼저 쓴다 */
  readonly priority: number;
  /** 0~100. 창 사용률이 100 - reservePct 이상이면 이 계정을 건너뛴다 */
  readonly reservePct: number;
}

export type UsageLimitAction = "wait" | "switch" | "fail";

/** l1.models.rateLimit[provider] */
export interface RateLimitPolicy {
  /** 같은 계정의 요청 사이 최소 간격 */
  readonly minIntervalMs: number;
  readonly onLimit: UsageLimitAction;
  /** 기다림의 상한. 넘으면 기다리지 않고 다음 계정으로 가거나 실패한다 */
  readonly maxWaitMs: number;
}

/** 정책이 없는 provider의 기본값: 간격 없음, 다른 계정으로 바꾸고 기다리지 않는다 [결정: 오케스트레이터 기본값] */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  minIntervalMs: 0,
  onLimit: "switch",
  maxWaitMs: 0,
};

/** 한도 오류에 재시도 시각이 없을 때 그 계정을 쉬게 하는 시간 [결정: 오케스트레이터 기본값] */
const DEFAULT_COOLDOWN_MS = 60_000;
/** quota_exhausted의 창 종료 시각을 모를 때 그 계정을 빼는 시간 [결정: 오케스트레이터 기본값] */
const DEFAULT_QUOTA_RESET_MS = 3_600_000;

type PickResult =
  | { readonly kind: "account"; readonly account: AccountDef }
  /** 쓸 수 있는 계정이 없지만 waitMs 뒤에는 생긴다. cause는 늦어지는 이유 */
  | { readonly kind: "wait"; readonly waitMs: number; readonly cause: "interval" | "cooldown" }
  /** 이 provider에 쓸 수 있는 계정이 (제외한 것을 빼면) 없다 */
  | { readonly kind: "none" };

export interface AccountPool {
  /** provider의 계정 중 지금 쓸 첫 계정을 고른다. exclude에 든 계정은 건너뛴다 */
  pick(
    accounts: readonly AccountDef[],
    provider: string,
    now: number,
    exclude?: ReadonlySet<string>,
  ): PickResult;
  /** 요청을 보냈다고 기록한다(minIntervalMs 계산용) */
  markRequest(account: AccountDef, now: number): void;
  /** rate_limited: retryAfterMs(없으면 기본값) 동안 그 계정을 쉬게 한다 */
  markRateLimited(account: AccountDef, now: number, retryAfterMs: number | null): void;
  /** quota_exhausted: untilMs(없으면 기본값)까지 그 계정을 뺀다 */
  markExhausted(account: AccountDef, now: number, untilMs: number | null): void;
  /** 창 사용률(0~100)을 알려 준다. reservePct 비교에 쓴다 */
  reportUtilization(account: AccountDef, pct: number): void;
}

interface AccountState {
  lastRequestAt: number | null;
  cooldownUntil: number;
  utilizationPct: number;
}

function keyOf(account: AccountDef): string {
  return `${account.provider}/${account.accountId}`;
}

export function createAccountPool(
  policyOf: (provider: string) => RateLimitPolicy = () => DEFAULT_RATE_LIMIT_POLICY,
): AccountPool {
  const states = new Map<string, AccountState>();

  function stateOf(account: AccountDef): AccountState {
    const found = states.get(keyOf(account));
    if (found !== undefined) return found;
    const created: AccountState = { lastRequestAt: null, cooldownUntil: 0, utilizationPct: 0 };
    states.set(keyOf(account), created);
    return created;
  }

  return {
    pick(accounts, provider, now, exclude = new Set()) {
      const policy = policyOf(provider);
      const candidates = accounts
        .map((account, index) => ({ account, index }))
        .filter(({ account }) => account.provider === provider && !exclude.has(account.accountId))
        .toSorted((a, b) => a.account.priority - b.account.priority || a.index - b.index);
      let soonest: { readonly at: number; readonly cause: "interval" | "cooldown" } | null = null;
      for (const { account } of candidates) {
        const state = stateOf(account);
        if (state.utilizationPct >= 100 - account.reservePct) continue;
        const intervalAt = (state.lastRequestAt ?? -Infinity) + policy.minIntervalMs;
        const readyAt = Math.max(state.cooldownUntil, intervalAt);
        if (readyAt <= now) return { kind: "account", account };
        const cause = state.cooldownUntil >= intervalAt ? "cooldown" : "interval";
        if (soonest === null || readyAt < soonest.at) soonest = { at: readyAt, cause };
      }
      return soonest === null
        ? { kind: "none" }
        : { kind: "wait", waitMs: soonest.at - now, cause: soonest.cause };
    },
    markRequest(account, now) {
      stateOf(account).lastRequestAt = now;
    },
    markRateLimited(account, now, retryAfterMs) {
      const state = stateOf(account);
      state.cooldownUntil = Math.max(
        state.cooldownUntil,
        now + (retryAfterMs ?? DEFAULT_COOLDOWN_MS),
      );
    },
    markExhausted(account, now, untilMs) {
      const state = stateOf(account);
      state.cooldownUntil = Math.max(state.cooldownUntil, untilMs ?? now + DEFAULT_QUOTA_RESET_MS);
    },
    reportUtilization(account, pct) {
      stateOf(account).utilizationPct = pct;
    },
  };
}
