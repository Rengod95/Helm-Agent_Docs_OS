import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RATE_LIMIT_POLICY,
  accountsOf,
  checkAccount,
  checkRateLimit,
  modelAccountsView,
  rateLimitOf,
  rotationRiskNotice,
  withAccount,
  withRateLimit,
  withoutAccount,
  withoutRateLimit,
  type AccountEntry,
  type AccountInput,
  type RateLimitEntry,
} from "../../src/accounts/index.ts";

const accountA: AccountEntry = {
  provider: "anthropic",
  accountId: "a",
  credential: "secret://acct-a",
  priority: 1,
  reservePct: 10,
};
const accountB: AccountEntry = {
  provider: "anthropic",
  accountId: "b",
  credential: "secret://acct-b",
  priority: 2,
  reservePct: 0,
};
const validInput: AccountInput = {
  provider: "openai",
  accountId: "team-1",
  credential: "secret://openai-team",
  priority: 0,
  reservePct: 100,
};
const waitPolicy: RateLimitEntry = { minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 };

describe("account input checks", () => {
  test("a valid account is returned as the typed entry", () => {
    expect(checkAccount(validInput)).toEqual({
      ok: true,
      value: {
        provider: "openai",
        accountId: "team-1",
        credential: "secret://openai-team",
        priority: 0,
        reservePct: 100,
      },
    });
  });

  test("the first wrong field is named, and a plain key value is not a reference", () => {
    expect(checkAccount({ ...validInput, accountId: "Team" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "accountId" },
    });
    expect(checkAccount({ ...validInput, provider: "" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "provider" },
    });
    // 평문 키는 참조가 아니다. 입력에서도 거른다
    expect(checkAccount({ ...validInput, credential: "sk-live-123" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "credential" },
    });
    expect(checkAccount({ ...validInput, priority: 1001 })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "priority" },
    });
    expect(checkAccount({ ...validInput, reservePct: 101 })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "reservePct" },
    });
    // 소수와 문자열 숫자는 정수가 아니다
    expect(checkAccount({ ...validInput, priority: 1.5 }).ok).toBe(false);
    expect(checkAccount({ ...validInput, reservePct: "10" }).ok).toBe(false);
  });

  test("a rate limit patch is merged over the current policy and each value is range-checked", () => {
    expect(checkRateLimit({ minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 })).toEqual({
      ok: true,
      value: waitPolicy,
    });
    // 빠진 칸은 현재 정책을 쓴다. 정책이 없으면 기본값이다
    expect(checkRateLimit({ maxWaitMs: 9000 }, waitPolicy)).toEqual({
      ok: true,
      value: { ...waitPolicy, maxWaitMs: 9000 },
    });
    expect(checkRateLimit({})).toEqual({ ok: true, value: DEFAULT_RATE_LIMIT_POLICY });
    expect(checkRateLimit({ minIntervalMs: 3_600_001 })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "minIntervalMs" },
    });
    expect(checkRateLimit({ minIntervalMs: 1.5 })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "minIntervalMs" },
    });
    expect(checkRateLimit({ onLimit: "retry" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "onLimit" },
    });
    expect(checkRateLimit({ maxWaitMs: -1 })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "maxWaitMs" },
    });
  });
});

describe("reading stored values", () => {
  test("accountsOf reads a valid list and falls back to empty on a wrong shape", () => {
    expect(accountsOf([accountA, accountB])).toEqual([accountA, accountB]);
    expect(accountsOf("nope")).toEqual([]);
    expect(accountsOf([{ ...accountA, credential: "sk-live-123" }])).toEqual([]);
    expect(accountsOf([{ ...accountA, extra: true }])).toEqual([]);
  });

  test("rateLimitOf reads a valid map and falls back to empty on a wrong shape", () => {
    expect(rateLimitOf({ anthropic: waitPolicy })).toEqual({ anthropic: waitPolicy });
    expect(rateLimitOf({ anthropic: { ...waitPolicy, onLimit: "retry" } })).toEqual({});
    expect(rateLimitOf(["anthropic"])).toEqual({});
    expect(rateLimitOf({ "Bad Name": waitPolicy })).toEqual({});
  });
});

describe("editors are pure and keep the list order", () => {
  test("withAccount replaces the entry with the same provider and accountId in place and appends a new one", () => {
    const changed = { ...accountA, priority: 5 };
    expect(withAccount([accountA, accountB], changed)).toEqual([changed, accountB]);
    expect(withAccount([accountA], accountB)).toEqual([accountA, accountB]);
    // 같은 accountId라도 provider가 다르면 다른 계정이다
    const otherProvider = { ...accountA, provider: "openai" };
    expect(withAccount([accountA], otherProvider)).toEqual([accountA, otherProvider]);
  });

  test("withoutAccount removes only the matching provider and accountId", () => {
    expect(withoutAccount([accountA, accountB], "anthropic", "a")).toEqual([accountB]);
    expect(withoutAccount([accountA], "openai", "a")).toEqual([accountA]);
  });

  test("withRateLimit starts a new provider from the default policy and merges a change into an existing one", () => {
    expect(withRateLimit({}, "openai", { maxWaitMs: 5 })).toEqual({
      openai: { minIntervalMs: 0, onLimit: "switch", maxWaitMs: 5 },
    });
    expect(withRateLimit({ anthropic: waitPolicy }, "anthropic", { maxWaitMs: 9000 })).toEqual({
      anthropic: { ...waitPolicy, maxWaitMs: 9000 },
    });
    expect(withoutRateLimit({ anthropic: waitPolicy, openai: waitPolicy }, "anthropic")).toEqual({
      openai: waitPolicy,
    });
  });

  test("the editors do not change the value they are given", () => {
    const list = [accountA];
    withAccount(list, accountB);
    withoutAccount(list, "anthropic", "a");
    const map = { anthropic: waitPolicy };
    withRateLimit(map, "anthropic", { maxWaitMs: 1 });
    expect(list).toEqual([accountA]);
    expect(map).toEqual({ anthropic: waitPolicy });
  });
});

describe("rotation state of the view", () => {
  const base = { accounts: [], rateLimit: {} };

  test("off while the plugin is disabled, even when the notice was acknowledged", () => {
    const view = modelAccountsView({ ...base, acknowledged: true, pluginEnabled: false });
    expect(view.rotation.state).toBe("off");
  });

  test("needsNotice when the plugin is on but the notice is not acknowledged", () => {
    expect(
      modelAccountsView({ ...base, acknowledged: false, pluginEnabled: true }).rotation.state,
    ).toBe("needsNotice");
    expect(
      modelAccountsView({ ...base, acknowledged: undefined, pluginEnabled: true }).rotation.state,
    ).toBe("needsNotice");
    // 문자열 "true"는 동의가 아니다
    expect(
      modelAccountsView({ ...base, acknowledged: "true", pluginEnabled: true }).rotation.state,
    ).toBe("needsNotice");
  });

  test("on when the plugin is on and acknowledged, and the notice text is the risk notice", () => {
    const view = modelAccountsView({ ...base, acknowledged: true, pluginEnabled: true });
    expect(view.rotation).toEqual({ state: "on", notice: rotationRiskNotice() });
  });

  test("the risk notice names the terms risk in Korean", () => {
    expect(rotationRiskNotice()).toBe(
      "이 플러그인은 한 provider의 여러 계정(API 키 계정과 구독 계정)을 돌려 가며 요청을 보냅니다. 구독 계정을 이렇게 쓰면 provider 이용 약관에 어긋날 수 있고 계정이 제한되거나 정지될 수 있습니다. 켜면 그 위험을 사용자가 집니다.",
    );
  });
});

describe("provider rows of the view", () => {
  test("providers are the union of accounts and policies, sorted by id", () => {
    const view = modelAccountsView({
      accounts: [{ ...accountA, provider: "openai", accountId: "o1" }, accountA],
      rateLimit: { google: waitPolicy, anthropic: { ...waitPolicy, maxWaitMs: 1 } },
      acknowledged: false,
      pluginEnabled: false,
    });
    expect(view.providers.map((row) => row.provider)).toEqual(["anthropic", "google", "openai"]);
  });

  test("accounts sort by priority and keep the given order on a tie, and the policy is null when absent", () => {
    const tie = { ...accountB, accountId: "c", priority: 2 };
    const view = modelAccountsView({
      accounts: [accountB, accountA, tie],
      rateLimit: {},
      acknowledged: true,
      pluginEnabled: true,
    });
    expect(view.providers).toEqual([
      { provider: "anthropic", accounts: [accountA, accountB, tie], policy: null },
    ]);
  });

  test("a policy-only provider has no accounts, and a wrong-shape input is ignored", () => {
    const view = modelAccountsView({
      accounts: "not a list",
      rateLimit: { anthropic: waitPolicy },
      acknowledged: true,
      pluginEnabled: true,
    });
    expect(view.providers).toEqual([{ provider: "anthropic", accounts: [], policy: waitPolicy }]);
  });
});
