import { assertNever } from "@fresnel/contracts";
import type { UiScalar } from "@fresnel/contracts/extensions";
import type { ResolvedItem } from "./resolve.ts";

// 보드(`Board`)와 순서 목록(`SortableList`)의 순수 계산(ADR-0021 §3.4.1, AGE-78 질문 7). React와 DOM이 없다.
// - 풀린 목록(평평한 레코드)에서 열과 카드를 만든다. 모르는 열의 카드, 겹친 id, id가 없는 원소는 뺀다.
// - 카드 하나를 다른 자리로 옮긴 배치를 만든다(놓는 즉시 화면이 바뀌는 낙관적 갱신에 쓴다).
// - 키보드로 든 카드의 다음 자리를 정한다(위아래는 같은 열, 왼쪽오른쪽은 옆 열).
// 쓰기 메서드의 인자 모양은 F `UI_ACTION_WIDGETS`의 규칙과 같다: Board.move { id, column, index }, Board.add { column, title },
// SortableList.move { id, index }. `index`는 옮긴 뒤 그 열이나 목록 안의 0부터 센 자리다.

export const BOARD_TONES = ["default", "muted", "success", "warning", "danger"] as const;
export type BoardTone = (typeof BOARD_TONES)[number];

export interface BoardCard {
  readonly id: string;
  readonly title: string;
  /** 보조 글 한 줄 */
  readonly detail?: string;
  /** 꼬리표 하나 */
  readonly tag?: string;
  readonly tone?: BoardTone;
}

export interface BoardColumn {
  readonly id: string;
  readonly title: string;
  readonly cards: readonly BoardCard[];
}

export type BoardLayout = readonly BoardColumn[];

/** 카드 하나의 자리. `index`는 그 열 안의 0부터 센 자리다 */
export interface BoardPlace {
  readonly column: string;
  readonly index: number;
}

/** 키보드로 든 카드를 옮기는 방향 */
export type BoardStep = "up" | "down" | "left" | "right";

export interface SortableItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
}

const TITLE_KEYS: readonly string[] = ["title", "label", "text", "name"];
const DETAIL_KEYS: readonly string[] = ["detail", "description"];

type ItemRecord = Readonly<Record<string, UiScalar>>;

function isRecord(item: ResolvedItem): item is ItemRecord {
  return typeof item === "object" && item !== null;
}

/** 글자이거나 유한한 수인 값의 글. 그 밖에는 undefined다 */
function textOf(value: UiScalar | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function fieldOf(item: ItemRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const text = textOf(Object.hasOwn(item, key) ? item[key] : undefined);
    if (text !== undefined && text !== "") return text;
  }
  return undefined;
}

function toneOf(value: UiScalar | undefined): BoardTone | undefined {
  return BOARD_TONES.find((tone) => tone === value);
}

/** 원소 하나의 id와 제목. 글자 원소는 id와 제목이 같다. id가 없거나 빈 글이면 undefined다 */
function headOf(
  item: ResolvedItem,
): { readonly id: string; readonly title: string; readonly record?: ItemRecord } | undefined {
  if (!isRecord(item)) {
    const text = textOf(item);
    return text === undefined || text === "" ? undefined : { id: text, title: text };
  }
  const id = textOf(Object.hasOwn(item, "id") ? item["id"] : undefined);
  if (id === undefined || id === "") return undefined;
  return { id, title: fieldOf(item, TITLE_KEYS) ?? id, record: item };
}

/** 카드 원소의 정렬 키. 수인 `order`가 없으면 맨 뒤(원래 차례를 지킨다) */
function orderOf(record: ItemRecord | undefined): number {
  const value =
    record !== undefined && Object.hasOwn(record, "order") ? record["order"] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * 풀린 `columns`와 `cards` 목록으로 보드 배치를 만든다. 열은 받은 차례, 카드는 열마다 `order`(없으면 받은 차례)다.
 * 열 id가 겹치면 앞의 것, 카드 id가 겹치면 앞의 것을 쓴다. 모르는 열을 가리키는 카드는 뺀다
 */
export function boardLayoutOf(
  columns: readonly ResolvedItem[],
  cards: readonly ResolvedItem[],
): BoardLayout {
  const heads: { readonly id: string; readonly title: string }[] = [];
  const seenColumns = new Set<string>();
  for (const item of columns) {
    const head = headOf(item);
    if (head === undefined || seenColumns.has(head.id)) continue;
    seenColumns.add(head.id);
    heads.push({ id: head.id, title: head.title });
  }
  const byColumn = new Map<string, { readonly card: BoardCard; readonly order: number }[]>(
    heads.map((head) => [head.id, []]),
  );
  const seenCards = new Set<string>();
  for (const item of cards) {
    const head = headOf(item);
    const record = head?.record;
    if (head === undefined || record === undefined || seenCards.has(head.id)) continue;
    const column = textOf(Object.hasOwn(record, "column") ? record["column"] : undefined);
    const bucket = column === undefined ? undefined : byColumn.get(column);
    if (bucket === undefined) continue;
    seenCards.add(head.id);
    const detail = fieldOf(record, DETAIL_KEYS);
    const tag = fieldOf(record, ["tag"]);
    const tone = toneOf(Object.hasOwn(record, "tone") ? record["tone"] : undefined);
    bucket.push({
      card: {
        id: head.id,
        title: head.title,
        ...(detail === undefined ? {} : { detail }),
        ...(tag === undefined ? {} : { tag }),
        ...(tone === undefined ? {} : { tone }),
      },
      order: orderOf(record),
    });
  }
  return heads.map((head) => ({
    id: head.id,
    title: head.title,
    cards: (byColumn.get(head.id) ?? [])
      .toSorted((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1))
      .map((entry) => entry.card),
  }));
}

/** 카드의 지금 자리. 없으면 undefined다 */
export function placeOf(layout: BoardLayout, id: string): BoardPlace | undefined {
  for (const column of layout) {
    const index = column.cards.findIndex((card) => card.id === id);
    if (index >= 0) return { column: column.id, index };
  }
  return undefined;
}

export function samePlace(a: BoardPlace | undefined, b: BoardPlace | undefined): boolean {
  return a !== undefined && b !== undefined && a.column === b.column && a.index === b.index;
}

/**
 * 카드 하나를 `to`로 옮긴 배치. `to.index`는 카드를 뺀 뒤 그 열에 넣을 자리이고 열 길이 안으로 맞춘다.
 * 카드나 열이 없으면 배치를 그대로 돌려준다
 */
export function moveCard(layout: BoardLayout, id: string, to: BoardPlace): BoardLayout {
  const from = placeOf(layout, id);
  const target = layout.find((column) => column.id === to.column);
  const card = layout.flatMap((column) => column.cards).find((entry) => entry.id === id);
  if (from === undefined || target === undefined || card === undefined) return layout;
  return layout.map((column) => {
    const rest =
      column.id === from.column ? column.cards.filter((entry) => entry.id !== id) : column.cards;
    if (column.id !== to.column) {
      return rest === column.cards ? column : { id: column.id, title: column.title, cards: rest };
    }
    const index = Math.max(0, Math.min(Math.trunc(to.index), rest.length));
    return {
      id: column.id,
      title: column.title,
      cards: [...rest.slice(0, index), card, ...rest.slice(index)],
    };
  });
}

/**
 * 키보드로 든 카드의 다음 자리. 위아래는 같은 열 안에서 한 칸, 왼쪽오른쪽은 옆 열의 같은 높이(그 열 길이까지)다.
 * 더 갈 곳이 없으면 undefined다. `layout`은 들고 있는 동안의 미리 보기 배치다
 */
export function stepPlace(
  layout: BoardLayout,
  id: string,
  step: BoardStep,
): BoardPlace | undefined {
  const at = placeOf(layout, id);
  if (at === undefined) return undefined;
  const columnIndex = layout.findIndex((column) => column.id === at.column);
  const column = layout[columnIndex];
  if (column === undefined) return undefined;
  switch (step) {
    case "up":
      return at.index > 0 ? { column: at.column, index: at.index - 1 } : undefined;
    case "down":
      return at.index < column.cards.length - 1
        ? { column: at.column, index: at.index + 1 }
        : undefined;
    case "left":
    case "right": {
      const next = layout[columnIndex + (step === "left" ? -1 : 1)];
      if (next === undefined) return undefined;
      return { column: next.id, index: Math.min(at.index, next.cards.length) };
    }
    default:
      return assertNever(step, "stepPlace");
  }
}

/** 순서 목록의 원소. 글자 원소는 id와 제목이 같다. id가 겹치면 앞의 것을 쓴다 */
export function sortableItemsOf(items: readonly ResolvedItem[]): readonly SortableItem[] {
  const seen = new Set<string>();
  const out: SortableItem[] = [];
  for (const item of items) {
    const head = headOf(item);
    if (head === undefined || seen.has(head.id)) continue;
    seen.add(head.id);
    const detail = head.record === undefined ? undefined : fieldOf(head.record, DETAIL_KEYS);
    out.push({ id: head.id, title: head.title, ...(detail === undefined ? {} : { detail }) });
  }
  return out;
}

/** 원소 하나를 `index`로 옮긴 목록. 없는 id면 그대로다 */
export function moveItem(
  items: readonly SortableItem[],
  id: string,
  index: number,
): readonly SortableItem[] {
  const item = items.find((entry) => entry.id === id);
  if (item === undefined) return items;
  const rest = items.filter((entry) => entry.id !== id);
  const at = Math.max(0, Math.min(Math.trunc(index), rest.length));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}
