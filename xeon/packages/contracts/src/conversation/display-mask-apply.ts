import { parse } from "../base/index.ts";
import { ItemRecordSchema, type ItemRecord } from "./hierarchy.ts";
import type { LeafMask, MaskRange, PartMask } from "./display-mask.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 화면 가림의 공용 적용기. 호스트가 redactor로 구한 구간(표식)을 받아 같은 문자열에 적용한다.
// 이 모듈은 값을 모른다. 패턴도 모른다. 구간이 맞지 않으면 그 잎을 전부 가린다(닫힌 쪽으로 실패).
// 데스크톱, 웹, 휴대폰 클라이언트가 같은 함수를 쓴다. 저장 행과 wire의 payload는 바뀌지 않는다.
// 이 함수들은 F 층에 둔다. 앱끼리는 서로 import하지 못하므로(DR-10) 여러 앱이 쓰려면 가장 낮은 층이어야 한다.

/** 구간이 맞지 않거나 길이가 다를 때 쓰는 표지. 값을 알 수 없으니 잎 전체를 가린다 */
const UNVERIFIED_LABEL = "unverified";

function hidden(label: string): string {
  return `[REDACTED:${label}]`;
}

/**
 * 구간을 표지로 바꾼다. 구간은 start 순서이고 겹치지 않아야 한다. 어긋나면 잎 전체를 가린다.
 * 표지는 호스트의 모델 입력 표지와 같은 모양이다(`[REDACTED:<표지>]`).
 */
export function applyRanges(text: string, ranges: readonly MaskRange[]): string {
  let out = "";
  let at = 0;
  for (const range of ranges) {
    const valid = range.start >= at && range.end > range.start && range.end <= text.length;
    if (!valid) return hidden(UNVERIFIED_LABEL);
    out += text.slice(at, range.start) + hidden(range.label);
    at = range.end;
  }
  return out + text.slice(at);
}

/** RFC 6901 토큰을 되돌린다 */
function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** 잎 치환의 결과. `ok: false`는 포인터가 가리는 것이 문자열이 아니라는 뜻이다(닫힌 쪽으로 실패) */
type Replaced = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/**
 * 포인터가 가리는 잎을 `replace`로 바꾼 새 트리를 돌려준다. 경로의 객체와 배열만 새로 만든다.
 * 포인터가 트리에 없으면 그대로 둔다(그 잎은 그려지지 않는다). 가리키는 것이 문자열이 아니면 `ok: false`다.
 */
function replaceLeaf(
  node: unknown,
  tokens: readonly string[],
  replace: (text: string) => string,
): Replaced {
  const [head, ...rest] = tokens;
  if (head === undefined) {
    return typeof node === "string" ? { ok: true, value: replace(node) } : { ok: false };
  }
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return { ok: true, value: node };
    }
    const child = replaceLeaf(items[index], rest, replace);
    if (!child.ok) return child;
    return { ok: true, value: items.map((item, i) => (i === index ? child.value : item)) };
  }
  if (typeof node === "object" && node !== null && Object.hasOwn(node, head)) {
    const entries: readonly (readonly [string, unknown])[] = Object.entries(node);
    const target = entries.find(([key]) => key === head);
    const child = replaceLeaf(target?.[1], rest, replace);
    if (!child.ok) return child;
    return {
      ok: true,
      value: Object.fromEntries(
        entries.map(([key, value]) => [key, key === head ? child.value : value]),
      ),
    };
  }
  return { ok: true, value: node };
}

/** 잎 치환 결과. 포인터가 가리는 것이 문자열이 아니면 `ok: false`다 */
export type LeafMaskResult = Replaced;

/**
 * 트리의 잎들에 표식을 적용한 새 트리를 돌려준다. 포인터는 `tree` 기준이다. 입력은 바뀌지 않는다.
 * 표식이 가리키는 자리가 문자열이 아니면 `ok: false`다(닫힌 쪽으로 실패). 스키마 검사는 하지 않는다.
 */
export function applyLeafMasks(tree: unknown, leaves: readonly LeafMask[]): LeafMaskResult {
  let out: LeafMaskResult = { ok: true, value: tree };
  for (const leaf of leaves) {
    if (!out.ok) return out;
    const tokens = leaf.pointer === "" ? [] : leaf.pointer.slice(1).split("/").map(unescapeToken);
    out = replaceLeaf(out.value, tokens, (text) => maskText(text, leaf));
  }
  return out;
}

/**
 * 한 문자열 잎을 표식으로 가린다. 표식이 없으면 원문이다. 길이가 표식과 다르면 `[REDACTED:unverified]`다.
 */
export function maskText(text: string, leaf: LeafMask | undefined): string {
  if (leaf === undefined) return text;
  return text.length === leaf.len ? applyRanges(text, leaf.ranges) : hidden(UNVERIFIED_LABEL);
}

/**
 * 내구 item 하나에 잎 표식을 적용한 복사본을 돌려준다. 입력은 바뀌지 않는다.
 * - 표식이 없으면 item을 그대로 돌려준다.
 * - 잎의 길이가 표식과 다르면 그 잎은 `[REDACTED:unverified]`가 된다.
 * - 표식이 가리키는 자리가 문자열이 아니거나 복사본이 item 모양을 벗어나면 `null`이다. 호출자는 읽을 수 없는 item으로 다룬다.
 */
export function maskItemRecord(
  item: ItemRecord,
  leaves: readonly LeafMask[] | undefined,
): ItemRecord | null {
  if (leaves === undefined || leaves.length === 0) return item;
  const masked = applyLeafMasks(item, leaves);
  if (!masked.ok) return null;
  const checked = parse(ItemRecordSchema, masked.value);
  return checked.ok ? checked.value : null;
}

/**
 * 진행 중 파트의 보이는 텍스트. `raw`는 클라이언트가 조각을 이어 붙인 원문이다.
 * - 표식이 없으면(표식을 싣지 않은 호스트) 원문을 그대로 쓴다.
 * - `verified: false`이거나 길이가 호스트의 누적과 다르면(조각을 놓쳤다) 빈 문자열이다. 확정 item이 올 때까지 보이지 않는다.
 * - 그 밖에는 보이는 앞부분에 구간을 적용한다. 뒤쪽 꼬리는 낱말이 끝날 때까지 빠진다.
 */
export function maskPartText(raw: string, mask: PartMask | undefined): string {
  if (mask === undefined) return raw;
  if (!mask.verified) return "";
  if (mask.len !== raw.length || mask.visible > raw.length) return "";
  return applyRanges(raw.slice(0, mask.visible), mask.ranges);
}
