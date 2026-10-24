import type { PricingTable } from "@xeon/contracts/capabilities";

// L2.web.spec §3.6.2, §4.4.2. 내장 provider 가격표. asOf가 90일보다 오래되면 경고한다(`just web-pricing`, 호출 경고).

/** 무료 provider의 표시. 가격표 대신 `free`를 쓴다 */
export type ProviderPricing = PricingTable | "free";

const SEARXNG_PRICING: ProviderPricing = "free";
const LOCAL_FETCH_PRICING: ProviderPricing = "free";

/**
 * 내장 검색 래퍼. 검색 1건 $10/1,000건 + 입력 $0.10/MTok + 출력 $0.50/MTok(Haiku 5.5 단가).
 * 토큰 수는 측정하지 않은 [가정]이다(ADR-0005 §3.2). 실측으로 바꾸는 절차는 `L2.web.plan` §7 첫 행.
 */
export const BUILTIN_WRAPPER_PRICING: PricingTable = {
  asOf: "2026-10-21",
  sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
  currency: "USD",
  units: {
    search: 0.01,
    tokens_in: 0.0000001,
    tokens_out: 0.0000005,
  },
};

/** 내장 provider ID → 가격표. 플러그인 가격표는 각 매니페스트가 가진다 */
export const BUILTIN_PRICING: Readonly<Record<string, ProviderPricing>> = {
  searxng: SEARXNG_PRICING,
  local: LOCAL_FETCH_PRICING,
  "builtin-wrapper": BUILTIN_WRAPPER_PRICING,
};

export const PRICING_STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** asOf(YYYY-MM-DD, UTC 자정)부터 지난 날 수. 날짜가 읽히지 않으면 undefined */
function pricingAgeDays(asOf: string, nowMs: number): number | undefined {
  const parsed = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(parsed)) return undefined;
  return Math.floor((nowMs - parsed) / DAY_MS);
}

/** 90일보다 오래된 가격표인가 */
export function isPricingStale(asOf: string, nowMs: number): boolean {
  const age = pricingAgeDays(asOf, nowMs);
  return age !== undefined && age > PRICING_STALE_DAYS;
}

export interface PricingAudit {
  readonly provider: string;
  readonly asOf: string;
  readonly ageDays: number;
  readonly stale: boolean;
}

/** `just web-pricing`이 쓰는 점검. 무료 provider는 건너뛴다. 오래된 항목이 먼저 온다 */
export function auditPricing(
  tables: Readonly<Record<string, ProviderPricing>>,
  nowMs: number,
): PricingAudit[] {
  const out: PricingAudit[] = [];
  for (const [provider, table] of Object.entries(tables)) {
    if (table === "free") continue;
    const age = pricingAgeDays(table.asOf, nowMs);
    if (age === undefined) continue;
    out.push({ provider, asOf: table.asOf, ageDays: age, stale: age > PRICING_STALE_DAYS });
  }
  return out.toSorted((a, b) => b.ageDays - a.ageDays);
}
