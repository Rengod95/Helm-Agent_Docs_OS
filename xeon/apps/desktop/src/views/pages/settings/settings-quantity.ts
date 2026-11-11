import { t, type MessageId } from "@fresnel/client/i18n";
import type { WidgetVM } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";

// 설정 숫자 칸의 판단과 글 바꾸기(L4.settings-ui §4.2.1 숫자 [결정: 2026-11-11 사용자]). 숫자 칸의 모양은 여기 하나가 정한다.
//   - 작은 정수(정수이고 최댓값이 20 이하): ± 스테퍼.
//   - 그 밖(토큰, 바이트, 밀리초, 초, 일, 큰 개수): ± 없는 글 칸 + 단위 접미사. "200K", "1.5M", "25MB", "90s", "10분" 같은 글을 받는다.
// 칸에 보이는 글과 접미사는 값의 크기에 맞는 단위로 고른다(25MB, 1분). 접미사 없이 친 숫자는 보이던 접미사의 단위로 읽는다.

export type QuantityUnit = "tokens" | "chars" | "count" | "bytes" | "ms" | "seconds" | "days";

/** 칸 오른쪽 접미사. 글은 화면이 카탈로그에서 고른다 */
export type QuantitySuffix =
  | "tokens"
  | "chars"
  | "count"
  | "days"
  | "seconds"
  | "minutes"
  | "hours"
  | "B"
  | "KB"
  | "MB"
  | "GB";

export type NumberControl =
  | { readonly kind: "stepper" }
  | { readonly kind: "quantity"; readonly unit: QuantityUnit; readonly zeroIsNone: boolean };

/** 스테퍼를 쓰는 최댓값의 상한. 이보다 크면 한 칸씩 올리는 단추가 쓸모없다 */
const STEPPER_MAX = 20;

/** 화면에 남은 숫자 키의 단위. 정의의 단위 글(로케일 글)을 믿지 않고 키로 정한다 */
const UNIT_OF_KEY: ReadonlyMap<SettingKey, QuantityUnit> = new Map([
  ["l1.persistence.retention.maxAgeDays", "days"],
  ["l1.persistence.retention.maxCount", "count"],
  ["l1.tools.unattended.timeoutSeconds", "seconds"],
]);

/** 0이 "제한 없음"인 키. 칸을 비우면 0으로 저장하고, 0이면 칸을 비워 자리 글을 보인다 */
const ZERO_IS_NONE: ReadonlySet<SettingKey> = new Set([
  "l1.persistence.retention.maxAgeDays",
  "l1.persistence.retention.maxCount",
]);

/** 표에 없는 키는 정의의 단위 글로 짐작한다(영문 정의 글 기준). 모르면 개수다 */
const UNIT_OF_TEXT: ReadonlyMap<string, QuantityUnit> = new Map([
  ["ms", "ms"],
  ["b", "bytes"],
  ["bytes", "bytes"],
  ["mb", "bytes"],
  ["tokens", "tokens"],
  ["chars", "chars"],
  ["s", "seconds"],
  ["sec", "seconds"],
  ["second", "seconds"],
  ["days", "days"],
  ["day", "days"],
]);

function unitOfText(unit: string | null): QuantityUnit {
  if (unit === null) return "count";
  return UNIT_OF_TEXT.get(unit.trim().toLowerCase()) ?? "count";
}

/** 숫자 항목의 칸 모양 */
export function numberControlOf(
  key: SettingKey,
  widget: Extract<WidgetVM, { readonly kind: "number" }>,
): NumberControl {
  const small =
    widget.integer && widget.max !== null && widget.max <= STEPPER_MAX && (widget.min ?? 0) >= 0;
  if (small && !UNIT_OF_KEY.has(key)) return { kind: "stepper" };
  return {
    kind: "quantity",
    unit: UNIT_OF_KEY.get(key) ?? unitOfText(widget.unit),
    zeroIsNone: ZERO_IS_NONE.has(key),
  };
}

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** 접미사 하나가 기본 단위로 몇인가 */
const FACTOR: Readonly<Record<QuantitySuffix, number>> = {
  tokens: 1,
  chars: 1,
  count: 1,
  days: 1,
  seconds: 1,
  minutes: 60,
  hours: 3600,
  B: 1,
  KB: KIB,
  MB: MIB,
  GB: GIB,
};

/** 소수 둘째 자리까지, 끝 0은 뗀다 */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** 천 단위 구분 쉼표 */
function grouped(value: number): string {
  const [whole = "0", fraction] = trimNumber(value).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "");
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? `${sign}${withCommas}` : `${sign}${withCommas}.${fraction}`;
}

export interface QuantityText {
  /** 칸 안의 글. 0이 "없음"인 키에서 0이면 빈 글이다 */
  readonly text: string;
  readonly suffix: QuantitySuffix;
}

/** 시간(초 기준)의 보이는 단위: 나누어떨어지는 가장 큰 단위 */
function timeSuffixOf(seconds: number): QuantitySuffix {
  if (seconds >= 3600 && seconds % 3600 === 0) return "hours";
  if (seconds >= 60 && seconds % 60 === 0) return "minutes";
  return "seconds";
}

function byteSuffixOf(bytes: number): QuantitySuffix {
  if (bytes >= GIB) return "GB";
  if (bytes >= MIB) return "MB";
  if (bytes >= KIB) return "KB";
  return "B";
}

/** 값을 칸의 글과 접미사로 바꾼다 */
export function quantityTextOf(
  value: number,
  unit: QuantityUnit,
  zeroIsNone: boolean,
): QuantityText {
  const empty = zeroIsNone && value === 0;
  switch (unit) {
    case "tokens":
    case "chars": {
      const suffix = unit;
      if (empty) return { text: "", suffix };
      if (value >= 1_000_000 && value % 10_000 === 0)
        return { text: `${trimNumber(value / 1_000_000)}M`, suffix };
      if (value >= 1000 && value % 100 === 0)
        return { text: `${trimNumber(value / 1000)}K`, suffix };
      return { text: grouped(value), suffix };
    }
    case "count":
    case "days":
      return { text: empty ? "" : grouped(value), suffix: unit };
    case "bytes": {
      const suffix = byteSuffixOf(value);
      return { text: empty ? "" : trimNumber(value / FACTOR[suffix]), suffix };
    }
    case "seconds": {
      const suffix = timeSuffixOf(value);
      return { text: empty ? "" : grouped(value / FACTOR[suffix]), suffix };
    }
    case "ms": {
      const seconds = value / 1000;
      const suffix = Number.isInteger(seconds) ? timeSuffixOf(seconds) : "seconds";
      return { text: empty ? "" : grouped(seconds / FACTOR[suffix]), suffix };
    }
    default:
      return assertNever(unit, "QuantityUnit");
  }
}

/** 친 글 끝의 단위 글이 가리키는 접미사. 단위 종류에 맞지 않는 글이면 null */
function suffixOfWord(word: string, unit: QuantityUnit): QuantitySuffix | "kilo" | "mega" | null {
  const w = word.toLowerCase();
  if (unit === "tokens" || unit === "chars" || unit === "count") {
    if (w === "k") return "kilo";
    if (w === "m") return "mega";
    return null;
  }
  if (unit === "bytes") {
    if (w === "b") return "B";
    if (w === "k" || w === "kb" || w === "kib") return "KB";
    if (w === "m" || w === "mb" || w === "mib") return "MB";
    if (w === "g" || w === "gb" || w === "gib") return "GB";
    return null;
  }
  // 접미사 글(현재 언어의 "초", "분" 같은 글)도 그 단위로 읽는다
  const said = (id: MessageId): boolean => w === t(id).toLowerCase();
  if (unit === "days") return w === "d" || said("desktop.settings.unit.days") ? "days" : null;
  if (w === "s" || w === "sec" || said("desktop.settings.unit.seconds")) return "seconds";
  if (w === "m" || w === "min" || said("desktop.settings.unit.minutes")) return "minutes";
  if (w === "h" || said("desktop.settings.unit.hours")) return "hours";
  return null;
}

export type QuantityParse =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: "syntax" };

/**
 * 친 글을 값(기본 단위: 토큰·글자·개수·일·초·바이트·밀리초)으로 읽는다. 쉼표와 공백은 무시한다.
 * 단위 글이 없으면 `shown`(칸에 보이던 접미사)의 단위로 읽는다. 빈 글은 0이 "없음"인 키에서만 0이다.
 */
export function parseQuantity(
  raw: string,
  unit: QuantityUnit,
  shown: QuantitySuffix,
  zeroIsNone: boolean,
): QuantityParse {
  const text = raw.replace(/[,\s]/g, "");
  if (text === "") return zeroIsNone ? { ok: true, value: 0 } : { ok: false, reason: "syntax" };
  const match = /^(\d+(?:\.\d+)?)([a-zA-Z가-힣]*)$/.exec(text);
  if (match === null) return { ok: false, reason: "syntax" };
  const amount = Number(match[1]);
  const word = match[2] ?? "";
  const suffix = word === "" ? shown : suffixOfWord(word, unit);
  if (suffix === null) return { ok: false, reason: "syntax" };
  const factor = suffix === "kilo" ? 1000 : suffix === "mega" ? 1_000_000 : FACTOR[suffix];
  const base = amount * factor;
  const value = unit === "ms" ? base * 1000 : base;
  return { ok: true, value: Math.round(value) };
}

/** 범위 문장(스키마의 min·max). 스테퍼와 단위 칸이 같이 쓴다 */
export function rangeTextOf(widget: Extract<WidgetVM, { readonly kind: "number" }>): string {
  if (widget.min !== null && widget.max !== null) {
    return t("client.settings.field.invalidRange", { min: widget.min, max: widget.max });
  }
  if (widget.min !== null) return t("client.settings.field.invalidMin", { min: widget.min });
  if (widget.max !== null) return t("client.settings.field.invalidMax", { max: widget.max });
  return t("client.settings.field.invalidValue");
}
