import { afterEach, describe, expect, test } from "bun:test";
import { createFetchCache } from "../src/cache/fetch-cache.ts";
import { renderPricingAudit } from "../src/cost/pricing-cli.ts";
import { createSessionLimits } from "../src/cost/limits.ts";
import { computeCost, createUsageMeter, monthKey } from "../src/cost/meter.ts";
import {
  auditPricing,
  BUILTIN_PRICING,
  BUILTIN_WRAPPER_PRICING,
  isPricingStale,
} from "../src/cost/pricing.ts";
import type { PricingTable } from "@xeon/contracts/capabilities";
import { manualClock } from "./support/clock.ts";
import { threadIdOf } from "./support/ids.ts";
import { openWebStore, releaseStores } from "./support/store.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 24);

afterEach(releaseStores);

const PAID: PricingTable = {
  asOf: "2026-10-01",
  sourceUrl: "https://vendor.example/pricing",
  currency: "USD",
  units: { search: 0.005, page_content: 0.001 },
  freeAllowance: { period: "month", usd: 10 },
};

describe("cost", () => {
  test("a provider that reports estimated usage is priced from the table", () => {
    const priced = computeCost(
      {
        provider: "builtin-wrapper",
        pricing: PAID,
        reported: {
          usd: 999,
          basis: "estimated",
          units: [
            { name: "search", count: 2 },
            { name: "page_content", count: 4 },
          ],
        },
        units: [{ name: "search", count: 1 }],
        contextChars: 0,
      },
      NOW,
    );
    // 알린 금액(999)은 믿지 않고 알린 사용량만 가격표로 계산한다
    expect(priced.cost.basis).toBe("estimated");
    expect(priced.cost.usd).toBeCloseTo(2 * 0.005 + 4 * 0.001, 10);
    expect(priced.cost.pricingAsOf).toBe(PAID.asOf);
    expect(priced.cost.units).toEqual([
      { name: "search", count: 2 },
      { name: "page_content", count: 4 },
    ]);
  });

  test("reported vs estimated vs free", () => {
    const reported = computeCost(
      {
        provider: "plugin:web-x",
        pricing: PAID,
        reported: { usd: 0.0123, basis: "reported", units: [{ name: "search", count: 1 }] },
        units: [{ name: "search", count: 1 }],
        contextChars: 1500,
      },
      NOW,
    );
    expect(reported.cost.basis).toBe("reported");
    expect(reported.cost.usd).toBe(0.0123);
    expect(reported.cost.pricingAsOf).toBeUndefined();
    expect(reported.cost.units).toContainEqual({ name: "context_chars", count: 1500 });

    const estimated = computeCost(
      {
        provider: "plugin:web-x",
        pricing: PAID,
        units: [
          { name: "search", count: 1 },
          { name: "page_content", count: 3 },
        ],
        contextChars: 800,
      },
      NOW,
    );
    expect(estimated.cost.basis).toBe("estimated");
    expect(estimated.cost.usd).toBeCloseTo(0.008, 10);
    expect(estimated.cost.pricingAsOf).toBe("2026-10-01");
    expect(estimated.cost.units).toContainEqual({ name: "context_chars", count: 800 });
    expect(estimated.warnings).toEqual([]);

    const free = computeCost(
      { provider: "searxng", pricing: "free", units: [], contextChars: 400 },
      NOW,
    );
    expect(free.cost).toEqual({
      usd: 0,
      basis: "free",
      units: [{ name: "context_chars", count: 400 }],
    });
  });

  test("a price table without prices is a free provider", () => {
    const empty: PricingTable = {
      asOf: PAID.asOf,
      sourceUrl: PAID.sourceUrl,
      currency: "USD",
      units: {},
    };
    const free = computeCost(
      {
        provider: "searxng",
        pricing: empty,
        units: [{ name: "search", count: 1 }],
        contextChars: 10,
      },
      NOW,
    );
    expect(free.cost.basis).toBe("free");
    expect(free.cost.usd).toBe(0);
    expect(free.warnings).toEqual([]);
    const zero: PricingTable = { ...PAID, units: { search: 0 } };
    expect(
      computeCost(
        { provider: "x", pricing: zero, units: [{ name: "search", count: 1 }], contextChars: 0 },
        NOW,
      ).cost.basis,
    ).toBe("free");
  });

  test("the builtin wrapper estimate follows the adr formula", () => {
    const wrapper = computeCost(
      {
        provider: "builtin-wrapper",
        pricing: BUILTIN_WRAPPER_PRICING,
        units: [
          { name: "search", count: 1 },
          { name: "tokens_in", count: 10_000 },
          { name: "tokens_out", count: 500 },
        ],
        contextChars: 0,
      },
      NOW,
    );
    // 검색 $0.010 + 입력 $0.001 + 출력 $0.00025
    expect(wrapper.cost.usd).toBeCloseTo(0.01125, 8);
    expect(wrapper.cost.pricingAsOf).toBe("2026-10-21");
  });

  test("pricing asOf stale warning", () => {
    const base = {
      provider: "plugin:web-x",
      units: [{ name: "search", count: 1 }],
      contextChars: 0,
    } as const;
    const asOf = Date.UTC(2026, 0, 1);
    const table: PricingTable = { ...PAID, asOf: "2026-01-01" };
    const at = (days: number): string[] => [
      ...computeCost({ ...base, pricing: table }, asOf + days * DAY).warnings,
    ];
    expect(at(89)).toEqual([]);
    expect(at(90)).toEqual([]);
    expect(at(91)).toEqual(["pricing_stale:plugin:web-x:2026-01-01"]);
    expect(at(120)).toEqual(["pricing_stale:plugin:web-x:2026-01-01"]);
    expect(isPricingStale("2026-01-01", asOf + 91 * DAY)).toBe(true);
    expect(isPricingStale("not-a-date", asOf + 400 * DAY)).toBe(false);
  });

  test("the audit lists dated tables oldest first and skips free providers", () => {
    const audit = auditPricing(
      {
        ...BUILTIN_PRICING,
        old: { ...PAID, asOf: "2026-01-01" },
        newer: { ...PAID, asOf: "2026-10-20" },
      },
      NOW,
    );
    expect(audit.map((row) => row.provider)).toEqual(["old", "newer", "builtin-wrapper"]);
    expect(audit.map((row) => row.stale)).toEqual([true, false, false]);
  });

  test("the audit prints warnings only and names the stale tables", () => {
    const stale = renderPricingAudit(auditPricing({ old: { ...PAID, asOf: "2026-01-01" } }, NOW));
    expect(stale).toContain("STALE old asOf=2026-01-01");
    expect(stale).toContain("경고 1개");
    const fresh = renderPricingAudit(auditPricing(BUILTIN_PRICING, NOW));
    expect(fresh).toContain("오래된 항목 없음");
  });

  test("free allowance warnings", async () => {
    const clock = manualClock(Date.UTC(2026, 9, 15));
    const store = await openWebStore(clock);
    expect(createFetchCache({ store: store.service, clock }).migrate().ok).toBe(true);
    const meter = createUsageMeter({ store: store.service, clock });
    const table: PricingTable = {
      ...PAID,
      units: { search: 1 },
      freeAllowance: { period: "month", usd: 10 },
    };
    const call = (count: number) =>
      meter.record(
        "plugin:web-x",
        computeCost(
          {
            provider: "plugin:web-x",
            pricing: table,
            units: [{ name: "search", count }],
            contextChars: 0,
          },
          clock.now(),
        ).cost,
        table,
      );
    const early = call(7);
    expect(early.ok && early.value).toEqual([]);
    const at80 = call(1);
    expect(at80.ok && at80.value).toEqual(["free_allowance_80:plugin:web-x"]);
    const at100 = call(2);
    expect(at100.ok && at100.value).toEqual(["free_allowance_exhausted:plugin:web-x"]);
    // 월이 바뀌면(UTC) 초기화된다
    clock.set(Date.UTC(2026, 10, 1));
    const reset = call(1);
    expect(reset.ok && reset.value).toEqual([]);
    expect(monthKey(clock.now())).toBe("2026-11");
    const totals = meter.monthTotals("plugin:web-x");
    expect(totals.ok && totals.value).toEqual([{ name: "search", count: 1, usd: 1 }]);
  });

  test("unit allowances compare per unit and reported totals are kept", async () => {
    const clock = manualClock(Date.UTC(2026, 9, 15));
    const store = await openWebStore(clock);
    createFetchCache({ store: store.service, clock }).migrate();
    const meter = createUsageMeter({ store: store.service, clock });
    const table: PricingTable = {
      ...PAID,
      freeAllowance: { period: "month", units: { search: 10 } },
    };
    for (let index = 0; index < 8; index += 1) {
      meter.record(
        "plugin:web-x",
        { usd: 0, basis: "estimated", units: [{ name: "search", count: 1 }] },
        table,
      );
    }
    const hit = meter.record(
      "plugin:web-x",
      { usd: 0, basis: "estimated", units: [{ name: "search", count: 1 }] },
      table,
    );
    expect(hit.ok && hit.value).toEqual(["free_allowance_80:plugin:web-x"]);
    const reported = meter.record(
      "plugin:web-y",
      { usd: 0.25, basis: "reported", units: [] },
      "free",
    );
    expect(reported.ok && reported.value).toEqual([]);
    const totals = meter.monthTotals("plugin:web-y");
    expect(totals.ok && totals.value).toEqual([{ name: "call", count: 1, usd: 0.25 }]);
  });

  test("session call limits", () => {
    const limits = createSessionLimits();
    const thread = threadIdOf(1);
    for (let index = 0; index < 100; index += 1) {
      expect(limits.take("search", thread, 1, 100)).toBeUndefined();
    }
    const refused = limits.take("search", thread, 1, 100);
    expect(refused?.code).toBe("session_limit");
    expect(refused?.retryable).toBe(false);
    expect(limits.used("search", thread)).toBe(100);
    // 검색과 읽기는 따로 센다. urls 3개는 3으로 센다
    expect(limits.take("fetch", thread, 3, 300)).toBeUndefined();
    expect(limits.used("fetch", thread)).toBe(3);
    expect(limits.take("fetch", thread, 298, 300)?.code).toBe("session_limit");
    expect(limits.used("fetch", thread)).toBe(3);
    expect(limits.take("fetch", thread, 297, 300)).toBeUndefined();
    // 세션마다 따로, 0은 상한 없음, 세션 없는 호출은 세지 않는다
    expect(limits.take("search", threadIdOf(2), 1, 100)).toBeUndefined();
    expect(limits.take("search", thread, 5000, 0)).toBeUndefined();
    expect(limits.take("search", undefined, 1, 1)).toBeUndefined();
    expect(limits.take("search", undefined, 1, 1)).toBeUndefined();
  });
});
