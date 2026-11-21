// 메트릭·트레이스의 숫자 표기. 토큰은 앱의 한 가지 표기(`tokenCountText`, DP-145)를 쓴다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import type { MetricReason } from "@fresnel/contracts/wire";
import { tokenCountText } from "../../model-usage.ts";
import type { Cell } from "./model.ts";

export function tokensText(tokens: number): string {
  return tokenCountText(tokens);
}

export function countText(n: number): string {
  return new Intl.NumberFormat(activeLocale()).format(Math.round(n));
}

export function percentText(ratio: number): string {
  const digits = ratio > 0 && ratio < 0.1 ? 1 : 0;
  return new Intl.NumberFormat(activeLocale(), {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** 1초 밑은 ms, 그 위는 초 한 자리 */
export function msText(ms: number): string {
  if (ms < 1000) return t("desktop.craft.metrics.unit.ms", { ms: countText(ms) });
  return t("desktop.craft.metrics.unit.s", {
    s: new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: 1 }).format(ms / 1000),
  });
}

const REASON_WORD: Readonly<Record<MetricReason, MessageId>> = {
  measurement_off: "desktop.craft.metrics.cell.off",
  not_recorded: "desktop.craft.metrics.cell.absent",
  needs_loader: "desktop.craft.metrics.cell.absent",
  beyond_retention: "desktop.craft.metrics.cell.expired",
  undefined_without_labels: "desktop.craft.metrics.cell.absent",
};

/** 값이 없는 칸의 말. 0으로 그리지 않는다 */
function missingText(cell: Exclude<Cell, { kind: "value" }>): string {
  if (cell.kind === "sample") return t("desktop.craft.metrics.cell.sample");
  return t(cell.reason === null ? "desktop.craft.metrics.cell.absent" : REASON_WORD[cell.reason]);
}

/** 칸의 글. 근사값은 앞에 `~`를 붙인다 */
export function cellText(cell: Cell, format: (value: number) => string): string {
  if (cell.kind !== "value") return missingText(cell);
  return cell.approx ? `~${format(cell.value)}` : format(cell.value);
}
