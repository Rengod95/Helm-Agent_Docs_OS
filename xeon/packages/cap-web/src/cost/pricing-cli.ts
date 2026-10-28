import { auditPricing, BUILTIN_PRICING, PRICING_STALE_DAYS, type PricingAudit } from "./pricing.ts";

// `just web-pricing`. 가격표 기준일(asOf)이 90일보다 오래된 항목을 출력한다. 경고만 내고 종료코드는 항상 0이다
// (L2.web.spec §4.4.2, L2.web.plan B5). 저장소 안 플러그인 가격표는 플러그인이 들어오는 M3에 더한다.

export function renderPricingAudit(audit: readonly PricingAudit[]): string {
  const lines = audit.map(
    (row) =>
      `${row.stale ? "STALE" : "ok   "} ${row.provider} asOf=${row.asOf} (${row.ageDays}일 전)`,
  );
  const stale = audit.filter((row) => row.stale).length;
  const summary =
    stale === 0
      ? `web-pricing: 가격표 ${audit.length}개, ${PRICING_STALE_DAYS}일보다 오래된 항목 없음`
      : `web-pricing: 경고 ${stale}개. 가격표가 ${PRICING_STALE_DAYS}일보다 오래됐다. 공급자 가격 페이지를 확인하고 asOf를 고친다`;
  return [...lines, summary].join("\n");
}

if (import.meta.main) {
  process.stdout.write(`${renderPricingAudit(auditPricing(BUILTIN_PRICING, Date.now()))}\n`);
}
