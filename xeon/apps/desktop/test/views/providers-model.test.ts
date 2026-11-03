import { describe, expect, test } from "bun:test";
import type { AccountEntry, RateLimitEntry } from "@fresnel/client";
import {
  ACCOUNT_FOLD_MAX,
  FALLBACK_MAX,
  chainsOf,
  foldOf,
  isProviderId,
  poolsOf,
  rateRowsOf,
  reprioritizedOf,
  roleRefsOf,
  withChain,
  withRoleRef,
} from "../../src/views/pages/providers/providers-model.ts";

// 계정과 제공자 화면(P-11)의 순수 모델. 값은 `toEqual`로 비교한다.

function account(
  provider: string,
  accountId: string,
  priority: number,
  reservePct = 0,
): AccountEntry {
  return { provider, accountId, credential: `secret://${accountId}-key`, priority, reservePct };
}

const POLICY: RateLimitEntry = { minIntervalMs: 500, onLimit: "wait", maxWaitMs: 30000 };

describe("poolsOf", () => {
  test("accounts group by provider, providers by id, accounts by priority", () => {
    const pools = poolsOf([
      account("openai", "team", 0),
      account("anthropic", "work", 20),
      account("anthropic", "personal", 10),
    ]);
    expect(pools.map((pool) => pool.provider)).toEqual(["anthropic", "openai"]);
    expect(pools[0]?.accounts.map((entry) => entry.accountId)).toEqual(["personal", "work"]);
    expect(pools[1]?.accounts.map((entry) => entry.accountId)).toEqual(["team"]);
  });
});

describe("foldOf", () => {
  test("a list longer than the fold shows the first twenty and counts the rest", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    expect(ACCOUNT_FOLD_MAX).toBe(20);
    expect(foldOf(items, false)).toEqual({ shown: items.slice(0, 20), hidden: 5 });
    expect(foldOf(items, true)).toEqual({ shown: items, hidden: 0 });
    expect(foldOf([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], hidden: 0 });
  });
});

describe("reprioritizedOf", () => {
  test("the accounts of one provider take their new order, ten apart; other providers stay", () => {
    const list = [
      account("anthropic", "work", 10),
      account("anthropic", "personal", 0),
      account("openai", "team", 5),
    ];
    expect(reprioritizedOf(list, "anthropic", ["personal", "work"])).toEqual([
      account("anthropic", "work", 10),
      account("anthropic", "personal", 0),
      account("openai", "team", 5),
    ]);
    expect(reprioritizedOf(list, "anthropic", ["work", "personal"])).toEqual([
      account("anthropic", "work", 0),
      account("anthropic", "personal", 10),
      account("openai", "team", 5),
    ]);
  });
});

describe("rateRowsOf", () => {
  test("policies are listed by provider id", () => {
    expect(rateRowsOf({ openai: POLICY, anthropic: { ...POLICY, minIntervalMs: 0 } })).toEqual([
      { provider: "anthropic", policy: { ...POLICY, minIntervalMs: 0 } },
      { provider: "openai", policy: POLICY },
    ]);
  });
});

describe("role references", () => {
  test("a map of strings reads, anything else does not", () => {
    expect(roleRefsOf({ main: "anthropic/claude-sonnet-5-5" })).toEqual({
      main: "anthropic/claude-sonnet-5-5",
    });
    expect(roleRefsOf({ main: 3 })).toBeNull();
    expect(roleRefsOf(["main"])).toBeNull();
    expect(roleRefsOf(null)).toBeNull();
  });

  test("a role is set or cleared without touching the others", () => {
    const refs = { main: "a/b", review: "c/d" };
    expect(withRoleRef(refs, "judge", "e/f")).toEqual({ main: "a/b", review: "c/d", judge: "e/f" });
    expect(withRoleRef(refs, "review", null)).toEqual({ main: "a/b" });
  });
});

describe("fallback chains", () => {
  test("a map of string lists reads, anything else does not", () => {
    expect(chainsOf({ main: ["a/b", "c/d"] })).toEqual({ main: ["a/b", "c/d"] });
    expect(chainsOf({ main: "a/b" })).toBeNull();
    expect(chainsOf({ main: [1] })).toBeNull();
  });

  test("an emptied chain removes its role", () => {
    expect(withChain({ main: ["a/b"], review: ["c/d"] }, "main", [])).toEqual({ review: ["c/d"] });
    expect(FALLBACK_MAX).toBe(3);
  });
});

describe("isProviderId", () => {
  test("a lowercase provider id with digits, dots, dashes or underscores passes", () => {
    expect(isProviderId("anthropic")).toBe(true);
    expect(isProviderId("open-ai.v2_x")).toBe(true);
    expect(isProviderId("Anthropic")).toBe(false);
    expect(isProviderId("a b")).toBe(false);
    expect(isProviderId("")).toBe(false);
  });
});
