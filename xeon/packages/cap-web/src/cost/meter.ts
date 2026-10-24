import { err, ok, type Clock, type Result } from "@xeon/contracts";
import type { Cost } from "@xeon/contracts/capabilities";
import type { WebStorePort } from "../ports/store.ts";
import { WEB_STORE_OWNER } from "../cache/migrations.ts";
import { numberCell, stringCell } from "../cache/rows.ts";
import { isPricingStale, type ProviderPricing } from "./pricing.ts";

// L2.web.spec §4.4.1~§4.4.3. 비용 계산(reported, estimated, free), 월 무료 한도 경고, `cap_web_usage` 누적.

export interface UsageUnit {
  readonly name: string;
  readonly count: number;
}

export interface CostInput {
  readonly provider: string;
  readonly pricing: ProviderPricing;
  /** provider 응답이 준 금액. 있으면 basis는 reported */
  readonly reported?: Cost;
  readonly units: readonly UsageUnit[];
  /** 컨텍스트에 들어간 텍스트 길이. 단위 `context_chars`로 항상 싣는다 */
  readonly contextChars: number;
}

export interface CostResult {
  readonly cost: Cost;
  readonly warnings: readonly string[];
}

function mergeUnits(units: readonly UsageUnit[]): UsageUnit[] {
  const sums = new Map<string, number>();
  for (const unit of units) sums.set(unit.name, (sums.get(unit.name) ?? 0) + unit.count);
  return [...sums].map(([name, count]) => ({ name, count }));
}

/** 순수 함수. 가격표 단가 × 단위로 금액을 추정하거나 provider가 준 금액을 쓴다 */
export function computeCost(input: CostInput, nowMs: number): CostResult {
  const withContext = mergeUnits([
    ...input.units,
    ...(input.contextChars > 0 ? [{ name: "context_chars", count: input.contextChars }] : []),
  ]).slice(0, 16);
  if (input.reported !== undefined) {
    const units = mergeUnits([
      ...input.reported.units,
      ...withContext.filter((u) => u.name === "context_chars"),
    ]).slice(0, 16);
    return { cost: { usd: input.reported.usd, basis: "reported", units }, warnings: [] };
  }
  if (input.pricing === "free") {
    return { cost: { usd: 0, basis: "free", units: withContext }, warnings: [] };
  }
  const prices = input.pricing.units;
  // 단가가 하나도 없거나 모두 0이면 무료 provider다(SearXNG)
  if (!Object.values(prices).some((price) => price > 0)) {
    return { cost: { usd: 0, basis: "free", units: withContext }, warnings: [] };
  }
  let usd = 0;
  for (const unit of withContext) {
    const price = prices[unit.name];
    if (price !== undefined) usd += price * unit.count;
  }
  const warnings = isPricingStale(input.pricing.asOf, nowMs)
    ? [`pricing_stale:${input.provider}:${input.pricing.asOf}`]
    : [];
  return {
    cost: { usd, basis: "estimated", units: withContext, pricingAsOf: input.pricing.asOf },
    warnings,
  };
}

export type MeterError =
  | { readonly kind: "write"; readonly detail: string }
  | { readonly kind: "read"; readonly detail: string }
  | { readonly kind: "row_invalid"; readonly column: string };

export interface UsageMeter {
  /** 호출 하나의 사용량을 이번 달(UTC) 표에 더하고, 무료 한도 경고를 돌려준다 */
  record(
    provider: string,
    cost: Cost,
    pricing: ProviderPricing,
  ): Result<readonly string[], MeterError>;
  /** 이번 달 provider의 단위별 누적 */
  monthTotals(
    provider: string,
  ): Result<readonly (UsageUnit & { readonly usd: number })[], MeterError>;
}

export function monthKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

function ratioOf(
  pricing: ProviderPricing,
  totals: readonly (UsageUnit & { readonly usd: number })[],
): number | undefined {
  if (pricing === "free" || pricing.freeAllowance === undefined) return undefined;
  const allowance = pricing.freeAllowance;
  const ratios: number[] = [];
  if (allowance.usd !== undefined && allowance.usd > 0) {
    ratios.push(totals.reduce((sum, row) => sum + row.usd, 0) / allowance.usd);
  }
  for (const [unit, limit] of Object.entries(allowance.units ?? {})) {
    if (limit <= 0) continue;
    const used = totals.find((row) => row.name === unit)?.count ?? 0;
    ratios.push(used / limit);
  }
  return ratios.length === 0 ? undefined : Math.max(...ratios);
}

export function createUsageMeter(deps: {
  readonly store: WebStorePort;
  readonly clock: Clock;
}): UsageMeter {
  const db = (): ReturnType<WebStorePort["scoped"]> => deps.store.scoped(WEB_STORE_OWNER);

  function monthTotals(
    provider: string,
  ): Result<(UsageUnit & { readonly usd: number })[], MeterError> {
    const read = db().read((tx) =>
      tx.all("SELECT unit, count, usd FROM cap_web_usage WHERE provider = ? AND month = ?", [
        provider,
        monthKey(deps.clock.now()),
      ]),
    );
    if (!read.ok) return err({ kind: "read", detail: read.error.kind });
    const out: (UsageUnit & { readonly usd: number })[] = [];
    for (const row of read.value) {
      const unit = stringCell(row, "unit");
      const count = numberCell(row, "count");
      const usd = numberCell(row, "usd");
      if (!unit.ok) return err(unit.error);
      if (!count.ok) return err(count.error);
      if (!usd.ok) return err(usd.error);
      out.push({ name: unit.value, count: count.value, usd: usd.value });
    }
    return ok(out);
  }

  return {
    monthTotals,
    record(provider, cost, pricing) {
      const month = monthKey(deps.clock.now());
      const prices = pricing === "free" ? {} : pricing.units;
      // 단위 행마다 금액을 나눈다. provider가 총액만 준 호출은 첫 단위 행(없으면 "call")에 총액을 싣는다
      const rows: { name: string; count: number; usd: number }[] =
        cost.units.length === 0
          ? [{ name: "call", count: 1, usd: cost.usd }]
          : cost.units.map((unit) => ({
              name: unit.name,
              count: unit.count,
              usd: cost.basis === "reported" ? 0 : (prices[unit.name] ?? 0) * unit.count,
            }));
      const first = rows[0];
      if (cost.basis === "reported" && first !== undefined) first.usd = cost.usd;
      const written = db().write((tx) => {
        for (const row of rows) {
          tx.run(
            `INSERT INTO cap_web_usage (provider, month, unit, count, usd) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(provider, month, unit) DO UPDATE SET count = count + excluded.count, usd = usd + excluded.usd`,
            [provider, month, row.name, row.count, row.usd],
          );
        }
      });
      if (!written.ok) return err({ kind: "write", detail: written.error.kind });
      const totals = monthTotals(provider);
      if (!totals.ok) return totals;
      const ratio = ratioOf(pricing, totals.value);
      if (ratio === undefined) return ok([]);
      if (ratio >= 1) return ok([`free_allowance_exhausted:${provider}`]);
      if (ratio >= 0.8) return ok([`free_allowance_80:${provider}`]);
      return ok([]);
    },
  };
}
