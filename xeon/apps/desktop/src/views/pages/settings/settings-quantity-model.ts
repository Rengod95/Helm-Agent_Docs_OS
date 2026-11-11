// 설정 숫자 칸의 판단. 어떤 모양으로 그릴지(± 단추 또는 단위가 붙은 글 칸), 글을 어떻게 읽을지, 요약 한 줄을 어떻게 쓸지.
// 순수 함수만 둔다. 부품은 settings-field.tsx(NumberControl)와 다른 숫자 칸이 쓴다.
// 단위 id는 정의의 `ui.unit` 원문이다(tokens, B, ms …). 화면 단위 글(unit)은 번역을 거치므로 종류를 가릴 때 쓰지 않는다.

/** ± 단추는 끝 값 차이가 이 값 이하인 정수 칸에만 둔다 */
const STEPPER_MAX_SPAN = 20;

export interface QuantityBounds {
  readonly min: number | null;
  readonly max: number | null;
  readonly integer: boolean;
}

export type NumberStyle = "stepper" | "quantity";

/** 정수이고 양 끝이 다 있고 범위가 20 이하인 칸만 "stepper"(±)다. 나머지는 단추 없는 "quantity"다 */
export function numberStyleOf(bounds: QuantityBounds): NumberStyle {
  if (!bounds.integer || bounds.min === null || bounds.max === null) return "quantity";
  return bounds.max - bounds.min <= STEPPER_MAX_SPAN ? "stepper" : "quantity";
}

/** 칸 부품의 appearance. "quantity"는 ±가 없는 글 칸(scrub 모양)이다 */
export function numberAppearanceOf(bounds: QuantityBounds): "stepper" | "scrub" {
  return numberStyleOf(bounds) === "stepper" ? "stepper" : "scrub";
}

export type UnitKind = "count" | "bytes" | "duration" | "money" | "other";

const COUNT_UNITS: ReadonlySet<string> = new Set([
  "tokens",
  "chars",
  "items",
  "times",
  "steps",
  "turns",
  "lines",
]);

/** 기간 단위마다 밀리초 수. 칸의 값은 이 단위로 센다 */
const DURATION_MS: ReadonlyMap<string, number> = new Map([
  ["ms", 1],
  ["s", 1_000],
  ["min", 60_000],
  ["days", 86_400_000],
]);

export function unitKindOf(unit: string | null): UnitKind {
  if (unit === null) return "other";
  if (COUNT_UNITS.has(unit)) return "count";
  if (unit === "B") return "bytes";
  if (DURATION_MS.has(unit)) return "duration";
  if (unit === "USD") return "money";
  return "other";
}

function fractionText(value: number, digits: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** 천 단위 구분을 넣은 글. 소수는 여섯 자리까지 남긴다(칸에 적힌 값을 깎지 않는다) */
export function formatQuantity(value: number, locale: string): string {
  return fractionText(value, 6, locale);
}

// ── 입력 읽기 ──────────────────────────────────────────────────────────────

/** 쉼표와 공백을 지운 뒤의 글: 숫자, 그리고 소문자 접미사(%도 한 글자로 받는다) */
const QUANTITY_TEXT = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/;

const COUNT_SCALE: ReadonlyMap<string, number> = new Map([
  ["", 1],
  ["k", 1_000],
  ["m", 1_000_000],
  ["g", 1_000_000_000],
]);

const BYTE_SCALE: ReadonlyMap<string, number> = new Map([
  ["", 1],
  ["b", 1],
  ["k", 1_024],
  ["kb", 1_024],
  ["kib", 1_024],
  ["m", 1_024 ** 2],
  ["mb", 1_024 ** 2],
  ["mib", 1_024 ** 2],
  ["g", 1_024 ** 3],
  ["gb", 1_024 ** 3],
  ["gib", 1_024 ** 3],
]);

/** 기간 접미사마다 밀리초 수. 접미사가 없으면 칸의 단위로 읽는다. 여기서 m은 분이다 */
const DURATION_SUFFIX_MS: ReadonlyMap<string, number> = new Map([
  ["ms", 1],
  ["s", 1_000],
  ["sec", 1_000],
  ["m", 60_000],
  ["min", 60_000],
  ["h", 3_600_000],
  ["hr", 3_600_000],
  ["d", 86_400_000],
  ["day", 86_400_000],
  ["days", 86_400_000],
]);

function scaleOf(
  scale: ReadonlyMap<string, number>,
  suffix: string,
  amount: number,
): number | null {
  const factor = scale.get(suffix);
  return factor === undefined ? null : amount * factor;
}

function scaledOf(amount: number, suffix: string, unit: string | null): number | null {
  const kind = unitKindOf(unit);
  if (kind === "count" || kind === "money") return scaleOf(COUNT_SCALE, suffix, amount);
  if (kind === "bytes") return scaleOf(BYTE_SCALE, suffix, amount);
  if (kind === "duration") {
    const target = unit === null ? undefined : DURATION_MS.get(unit);
    const factor = suffix === "" ? target : DURATION_SUFFIX_MS.get(suffix);
    return target === undefined || factor === undefined ? null : (amount * factor) / target;
  }
  return suffix === "" || suffix === "%" ? amount : null;
}

/**
 * 칸에 적힌 글을 값으로 읽는다. 쉼표와 공백은 무시한다. K·M·G는 개수에서 1000 배, 바이트에서 1024 배다.
 * 기간 칸은 "30s", "2m"(분), "1.5h"처럼 적은 시간을 칸의 단위로 환산한다. 접미사가 없으면 칸의 단위다.
 * `integer`가 참인데 소수가 나오면 읽지 못한 것이다. 읽을 수 없으면 null이다.
 */
export function parseQuantity(text: string, unit: string | null, integer?: boolean): number | null {
  const match = QUANTITY_TEXT.exec(text.replace(/[,\s]/g, "").toLowerCase());
  if (match === null) return null;
  const [, numberText = "", suffix = ""] = match;
  const scaled = scaledOf(Number(numberText), suffix, unit);
  if (scaled === null || !Number.isFinite(scaled)) return null;
  // 곱셈의 부동소수점 잡음(1.1 * 1000 등)을 걷어 낸다
  const value = Number(scaled.toPrecision(15));
  return integer === true && !Number.isInteger(value) ? null : value;
}

// ── 요약 한 줄 ─────────────────────────────────────────────────────────────

/** 기간 요약의 낱말. 호출하는 쪽이 번역 문장을 넣는다("{n}초", "{n} min" …) */
export interface DurationWords {
  readonly seconds: (amount: string) => string;
  readonly minutes: (amount: string) => string;
  readonly hours: (amount: string) => string;
  readonly days: (amount: string) => string;
}

export interface SummaryEnv {
  readonly locale: string;
  readonly words: DurationWords;
}

/** 칸의 단위 두 가지: 원문(종류를 가릴 때)과 화면 글(개수 뒤에 붙일 때) */
export interface UnitTag {
  readonly id: string | null;
  readonly label: string | null;
}

const DECIMAL_SUFFIXES: readonly string[] = ["", "K", "M", "G"];
const BINARY_SUFFIXES: readonly string[] = ["B", "KB", "MB", "GB", "TB"];

/** 값을 base로 나눌 만큼 나눈다(가장 큰 접두를 넘지 않는다). 두 자리 소수까지 쓴다 */
function fitted(
  value: number,
  base: number,
  steps: number,
  locale: string,
): { readonly amount: string; readonly step: number } {
  let scaled = value;
  let step = 0;
  while (Math.abs(scaled) >= base && step < steps - 1) {
    scaled /= base;
    step += 1;
  }
  return { amount: fractionText(scaled, 2, locale), step };
}

function durationText(totalMs: number, env: SummaryEnv): string {
  const { locale, words } = env;
  if (Math.abs(totalMs) < 1_000) return `${fractionText(totalMs, 0, locale)} ms`;
  const seconds = totalMs / 1_000;
  const size = Math.abs(seconds);
  if (size < 60) return words.seconds(fractionText(seconds, 1, locale));
  if (size < 3_600) {
    return seconds % 60 === 0
      ? words.minutes(fractionText(seconds / 60, 0, locale))
      : words.seconds(fractionText(seconds, 0, locale));
  }
  if (size < 86_400) return words.hours(fractionText(seconds / 3_600, 1, locale));
  return words.days(fractionText(seconds / 86_400, 1, locale));
}

/**
 * 값을 사람이 읽기 쉬운 한 줄로 옮긴다.
 * 예: 200000 tokens → "200K tokens"(한국어는 "200K 토큰"), 2097152 B → "2 MB", 90000 ms → "90초"(영어 "90 sec").
 */
export function quantitySummaryOf(value: number, unit: UnitTag, env: SummaryEnv): string {
  const kind = unitKindOf(unit.id);
  const withLabel = (text: string): string =>
    unit.label === null ? text : `${text} ${unit.label}`;
  if (kind === "count") {
    const { amount, step } = fitted(value, 1_000, DECIMAL_SUFFIXES.length, env.locale);
    return withLabel(`${amount}${DECIMAL_SUFFIXES.at(step) ?? ""}`);
  }
  if (kind === "bytes") {
    const { amount, step } = fitted(value, 1_024, BINARY_SUFFIXES.length, env.locale);
    return `${amount} ${BINARY_SUFFIXES.at(step) ?? "B"}`;
  }
  if (kind === "duration") {
    return durationText(value * (DURATION_MS.get(unit.id ?? "") ?? 1), env);
  }
  if (kind === "money") {
    return new Intl.NumberFormat(env.locale, { style: "currency", currency: "USD" }).format(value);
  }
  return withLabel(fractionText(value, 6, env.locale));
}

/**
 * 환산 한 줄을 보일 가치가 있는가. 0은 "끔"이나 "무제한" 뜻일 때가 많아 환산이 오해를 부르고,
 * 칸에 적힌 숫자와 같은 글("300")은 군더더기다. 단위 라벨만 붙은 같은 글("300 일")도 뺀다.
 */
export function quantitySummaryShownOf(
  value: number,
  summary: string,
  unit: UnitTag,
  locale: string,
): boolean {
  if (value === 0) return false;
  const plain = formatQuantity(value, locale);
  return summary !== plain && summary !== (unit.label === null ? plain : `${plain} ${unit.label}`);
}

// ── 화살표 키와 프리셋 ─────────────────────────────────────────────────────

/** 화살표 키 한 칸. 값 자릿수 한 단계 아래를 쓴다(200,000이면 10,000). 값이 없거나 0이면 1이다 */
export function quantityStepOf(value: number | null): number {
  if (value === null || value === 0) return 1;
  return 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(value))) - 1);
}

/**
 * 기본값 근처의 프리셋: 기본값의 절반, 기본값, 두 배를 범위 안에서 작은 순으로 고른다.
 * 정수 칸이면 내림한 정수다. 화면에 붙이는 일은 따로 정한다.
 */
export function presetsOf(bounds: QuantityBounds, defaultValue: number): readonly number[] {
  const candidates = [defaultValue / 2, defaultValue, defaultValue * 2].map((value) =>
    bounds.integer ? Math.floor(value) : value,
  );
  const inRange = candidates.filter(
    (value) =>
      (bounds.min === null || value >= bounds.min) && (bounds.max === null || value <= bounds.max),
  );
  return [...new Set(inRange)].toSorted((a, b) => a - b);
}
