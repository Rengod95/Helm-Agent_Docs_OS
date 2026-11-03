import { expect, test } from "bun:test";
import { isPinnedTier, orderEntries, PINNED_TIER_RANK } from "../../src/primitives/order.ts";

interface Item {
  readonly scopeId: string;
  readonly label: string;
  readonly tier: number;
}

function item(scopeId: string, tier: number, label = scopeId): Item {
  return { scopeId, label, tier };
}

function tierOfItem(entry: Item): number {
  return entry.tier;
}

function labelsOf(items: readonly Item[]): string[] {
  return items.map((entry) => entry.label);
}

// 기본 정렬 결과를 흉내 낸다: guard(0)가 먼저, 나머지는 tier 순
const GUARD = item("g", PINNED_TIER_RANK);

test("PINNED_TIER_RANK is the guard tier, 0, and only it is pinned", () => {
  expect(PINNED_TIER_RANK).toBe(0);
  expect(isPinnedTier(0)).toBe(true);
  expect(isPinnedTier(1)).toBe(false);
  expect(isPinnedTier(3)).toBe(false);
});

test("no override keeps the default order: pinned first, then the rest as given", () => {
  const sorted = [GUARD, item("a", 1), item("b", 1), item("c", 2)];
  expect(labelsOf(orderEntries(sorted, tierOfItem, undefined))).toEqual(["g", "a", "b", "c"]);
  expect(labelsOf(orderEntries(sorted, tierOfItem, []))).toEqual(["g", "a", "b", "c"]);
});

test("a full override reverses the non-pinned entries and leaves the guard first", () => {
  const sorted = [GUARD, item("a", 1), item("b", 1), item("c", 2)];
  const result = orderEntries(sorted, tierOfItem, ["c", "b", "a"]);
  expect(labelsOf(result)).toEqual(["g", "c", "b", "a"]);
});

test("a partial override moves only the named entries; unnamed entries keep their slots", () => {
  const sorted = [item("a", 1), item("x", 1), item("b", 1), item("y", 1), item("c", 1)];
  // a는 슬롯 0, c는 슬롯 4. 이름 없는 x·b·y는 그대로다
  const result = orderEntries(sorted, tierOfItem, ["c", "a"]);
  expect(labelsOf(result)).toEqual(["c", "x", "b", "y", "a"]);
});

test("an override naming a registration that matches no entry is ignored", () => {
  const sorted = [item("a", 1), item("b", 1), item("c", 1)];
  const result = orderEntries(sorted, tierOfItem, ["zzz", "b", "nope", "a"]);
  expect(labelsOf(result)).toEqual(["b", "a", "c"]);
});

test("a pinned entry named in the override is ignored and stays first", () => {
  const sorted = [GUARD, item("a", 1), item("b", 1)];
  // g를 어디에 두든 고정 항목은 맨 앞에 남고, a·b만 서로 바뀐다
  expect(labelsOf(orderEntries(sorted, tierOfItem, ["b", "g", "a"]))).toEqual(["g", "b", "a"]);
  expect(labelsOf(orderEntries(sorted, tierOfItem, ["g", "b", "a"]))).toEqual(["g", "b", "a"]);
});

test("nothing can be placed above a pinned entry, even when the override lists it last or first", () => {
  const sorted = [item("g1", 0), item("g2", 0), item("a", 1), item("b", 2)];
  expect(labelsOf(orderEntries(sorted, tierOfItem, ["a", "b", "g1", "g2"]))).toEqual([
    "g1",
    "g2",
    "a",
    "b",
  ]);
  expect(labelsOf(orderEntries(sorted, tierOfItem, ["b", "a", "g2"]))).toEqual([
    "g1",
    "g2",
    "b",
    "a",
  ]);
});

test("entries sharing a scopeId keep their relative order and share one override rank", () => {
  // 한 등록(c 자리의 a)이 같은 훅에 `on`을 두 번 부른 경우
  const sorted = [item("a", 1, "a#1"), item("b", 1), item("a", 1, "a#2"), item("c", 1)];
  const result = orderEntries(sorted, tierOfItem, ["c", "a"]);
  expect(labelsOf(result)).toEqual(["c", "b", "a#1", "a#2"]);
});

test("the input array and the override are not mutated", () => {
  const sorted = [GUARD, item("a", 1), item("b", 1), item("c", 2)];
  const override = ["c", "a", "b"];
  const sortedBefore = [...sorted];
  const overrideBefore = [...override];
  const result = orderEntries(sorted, tierOfItem, override);
  expect(sorted).toEqual(sortedBefore);
  expect(override).toEqual(overrideBefore);
  expect(result).not.toBe(sorted);
});
