import { assertNever, attempt } from "@fresnel/contracts";
import type { UiFormat } from "@fresnel/contracts/extensions";

// 바인드 서식(ADR-0021 §3.4.1, format: "duration" 등). 서식에 맞지 않는 값이나 쓸 수 없는 locale이면 undefined다.
// duration과 bytes는 locale과 무관한 고정 표기("." 소수점)다. dateTime은 UTC로 그린다(호스트 시간대를 모른다).

type RelativeUnit = "day" | "hour" | "minute" | "second";

const RELATIVE_UNITS: readonly { readonly unit: RelativeUnit; readonly ms: number }[] = [
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
  { unit: "second", ms: 1_000 },
];

const BYTE_STEPS: readonly string[] = ["MiB", "GiB", "TiB"];

// 날짜 문자열은 ISO 8601이고 시간이 있으면 시간대 표시가 있어야 한다. 시간대가 없으면 기기마다 해석이 달라진다.
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

export function formatValue(
  format: UiFormat,
  value: unknown,
  locale: string,
  nowMs: number,
): string | undefined {
  switch (format) {
    case "duration":
      return typeof value === "number" ? formatDuration(value) : undefined;
    case "bytes":
      return typeof value === "number" ? formatBytes(value) : undefined;
    case "relativeTime":
      return formatRelative(value, locale, nowMs);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? formatNumber(value, locale)
        : undefined;
    case "percent":
      return typeof value === "number" && isRatio(value) ? formatPercent(value, locale) : undefined;
    case "dateTime": {
      const date = toDate(value);
      return date === undefined ? undefined : formatDateTime(date, locale);
    }
    default:
      return assertNever(format, "formatValue");
  }
}

/** 밀리초를 "1.5s", "2m 3s", "1h 5m"처럼 적는다. 0초는 생략한다 */
function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const millis = Math.round(ms);
  if (millis < 1000) return `${millis}ms`;
  // 60초 아래는 소수 첫째 자리까지. 반올림해서 60.0이 되면 분 단위로 넘어간다
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${tenths / 10}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** 바이트를 1024 단위로 적는다. "512 B", "1.5 KiB", "2 MiB". 소수 첫째 자리에서 1024가 되면 다음 단위로 올린다 */
function formatBytes(bytes: number): string | undefined {
  if (!Number.isFinite(bytes) || bytes < 0) return undefined;
  if (Math.round(bytes) < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = "KiB";
  for (const next of BYTE_STEPS) {
    if (Math.round(value * 10) < 10240) break;
    value /= 1024;
    unit = next;
  }
  return `${Math.round(value * 10) / 10} ${unit}`;
}

/** 지금과의 차이를 가장 큰 맞는 단위(일, 시간, 분, 초)로 적는다. 1초 미만은 "now"다 */
function formatRelative(value: unknown, locale: string, nowMs: number): string | undefined {
  const date = toDate(value);
  if (date === undefined || !Number.isFinite(nowMs)) return undefined;
  const diff = date.getTime() - nowMs;
  const scale = RELATIVE_UNITS.find((step) => Math.abs(diff) >= step.ms);
  const unit: RelativeUnit = scale === undefined ? "second" : scale.unit;
  const count = scale === undefined ? 0 : Math.trunc(diff / scale.ms);
  return intl(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(count, unit));
}

function formatNumber(value: number, locale: string): string | undefined {
  return intl(() => new Intl.NumberFormat(locale).format(value));
}

/** 비율 0..1을 정수 퍼센트로 적는다 */
function formatPercent(ratio: number, locale: string): string | undefined {
  return intl(() =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(ratio),
  );
}

function formatDateTime(date: Date, locale: string): string | undefined {
  return intl(() =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date),
  );
}

/** 잘못된 locale 같은 Intl 실패는 값을 쓸 수 없는 것으로 보고 undefined를 돌려준다. 호출자는 이 prop을 두지 않는다 */
function intl(run: () => string): string | undefined {
  const result = attempt(run);
  return result.ok ? result.value : undefined;
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function toDate(value: unknown): Date | undefined {
  if (typeof value === "number") return validDate(value);
  if (typeof value === "string" && ISO_DATE.test(value)) return validDate(Date.parse(value));
  return undefined;
}

function validDate(ms: number): Date | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
