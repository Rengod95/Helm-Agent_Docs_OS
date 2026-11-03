import { expect, test } from "bun:test";
import { orderEntries } from "../../src/primitives/order.ts";

interface Item {
  readonly scopeId: string;
  readonly label: string;
}

function item(scopeId: string, label = scopeId): Item {
  return { scopeId, label };
}

function labelsOf(items: readonly Item[]): string[] {
  return items.map((entry) => entry.label);
}

// 기본 정렬 결과를 흉내 낸다: guard(g)가 맨 앞, 나머지는 tier 순. guard도 덮어쓰기의 이름으로 옮길 수 있다(2026-11-03)
const GUARD = item("g");

test("no override keeps the default order, guard first", () => {
  const sorted = [GUARD, item("a"), item("b"), item("c")];
  expect(labelsOf(orderEntries(sorted, undefined))).toEqual(["g", "a", "b", "c"]);
  expect(labelsOf(orderEntries(sorted, []))).toEqual(["g", "a", "b", "c"]);
});

test("a full override reverses the entries and moves the guard like any other entry", () => {
  const sorted = [GUARD, item("a"), item("b"), item("c")];
  expect(labelsOf(orderEntries(sorted, ["c", "b", "a", "g"]))).toEqual(["c", "b", "a", "g"]);
});

test("a guard named after regular entries moves behind them", () => {
  const sorted = [GUARD, item("a"), item("b")];
  // g가 차지한 자리(0)는 덮어쓰기의 첫 이름 a에게 가고, g는 가장 나중 자리로 간다
  expect(labelsOf(orderEntries(sorted, ["a", "b", "g"]))).toEqual(["a", "b", "g"]);
});

test("a guard named after one regular entry takes that entry's slot", () => {
  const sorted = [GUARD, item("a"), item("b"), item("c")];
  // b가 g의 자리(0)로 가고 g는 b가 있던 자리(2)로 간다. a·c는 이름이 없어 자리를 지킨다
  expect(labelsOf(orderEntries(sorted, ["b", "g"]))).toEqual(["b", "a", "g", "c"]);
});

test("a partial override moves only the named entries; unnamed entries keep their slots", () => {
  const sorted = [item("a"), item("x"), item("b"), item("y"), item("c")];
  // a는 슬롯 0, c는 슬롯 4. 이름 없는 x·b·y는 그대로다
  const result = orderEntries(sorted, ["c", "a"]);
  expect(labelsOf(result)).toEqual(["c", "x", "b", "y", "a"]);
});

test("an override naming the guard first keeps it first, as the default order does", () => {
  const sorted = [GUARD, item("a"), item("x")];
  expect(labelsOf(orderEntries(sorted, ["g", "x", "a"]))).toEqual(["g", "x", "a"]);
});

test("an override naming a registration that matches no entry is ignored", () => {
  const sorted = [item("a"), item("b"), item("c")];
  const result = orderEntries(sorted, ["zzz", "b", "nope", "a"]);
  expect(labelsOf(result)).toEqual(["b", "a", "c"]);
});

test("entries sharing a scopeId keep their relative order and share one override rank", () => {
  // 한 등록(c 자리의 a)이 같은 훅에 `on`을 두 번 부른 경우
  const sorted = [item("a", "a#1"), item("b"), item("a", "a#2"), item("c")];
  const result = orderEntries(sorted, ["c", "a"]);
  expect(labelsOf(result)).toEqual(["c", "b", "a#1", "a#2"]);
});

test("the input array and the override are not mutated", () => {
  const sorted = [GUARD, item("a"), item("b"), item("c")];
  const override = ["c", "a", "g"];
  const sortedBefore = [...sorted];
  const overrideBefore = [...override];
  const result = orderEntries(sorted, override);
  expect(sorted).toEqual(sortedBefore);
  expect(override).toEqual(overrideBefore);
  expect(result).not.toBe(sorted);
});
