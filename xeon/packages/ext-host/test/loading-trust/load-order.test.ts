import { expect, test } from "bun:test";
import {
  BUILTIN_LAYER_ORDER,
  compareLoadOrder,
  orderManifests,
  type OrderKey,
} from "../../src/loading-trust/index.ts";

interface Item {
  readonly key: OrderKey;
}

function item(
  source: OrderKey["source"],
  layer: (typeof BUILTIN_LAYER_ORDER)[number],
  name: string,
): Item {
  return {
    key: {
      source,
      layerIndex: source === "builtin" ? BUILTIN_LAYER_ORDER.indexOf(layer) : 0,
      name,
    },
  };
}

const ITEMS: readonly Item[] = [
  item("project", "plugin", "proj-a"),
  item("user", "plugin", "user-b"),
  item("user", "plugin", "user-a"),
  item("managed", "plugin", "managed-a"),
  item("builtin", "L3", "group-helm"),
  item("builtin", "L1", "core-loop"),
  item("builtin", "L2", "cap-web"),
  item("builtin", "L2", "cap-mcp"),
  item("builtin", "plugin", "some-plugin"),
];

/** 시드 고정 셔플(Fisher-Yates + 선형 합동 생성기). 시험이 실제 난수에 기대지 않는다 */
function shuffled(items: readonly Item[], seed: number): Item[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    const other = state % (index + 1);
    const left = copy[index];
    const right = copy[other];
    if (left !== undefined && right !== undefined) {
      copy[index] = right;
      copy[other] = left;
    }
  }
  return copy;
}

test("load-order: deterministic order", () => {
  const expected = orderManifests(ITEMS).map((entry) => entry.key.name);
  for (let seed = 1; seed <= 100; seed += 1) {
    expect(orderManifests(shuffled(ITEMS, seed)).map((entry) => entry.key.name)).toEqual(expected);
  }
});

test("load-order: source and layer precedence", () => {
  expect(orderManifests(ITEMS).map((entry) => entry.key.name)).toEqual([
    "core-loop",
    "cap-mcp",
    "cap-web",
    "group-helm",
    "some-plugin",
    "managed-a",
    "user-a",
    "user-b",
    "proj-a",
  ]);
  expect(
    compareLoadOrder(item("builtin", "L3", "z").key, item("managed", "plugin", "a").key),
  ).toBeLessThan(0);
  expect(compareLoadOrder(item("user", "plugin", "a").key, item("user", "plugin", "a").key)).toBe(
    0,
  );
});
