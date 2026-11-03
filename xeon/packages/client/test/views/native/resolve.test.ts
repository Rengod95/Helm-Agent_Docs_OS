import { describe, expect, test } from "bun:test";
import type { UiNode } from "@fresnel/contracts/extensions";
import {
  resolveTree,
  type ResolvedNode,
  type ResolvedTree,
} from "../../../src/views/native/resolve.ts";
import { helmInquiryDoc, loadHelmTree } from "./fixtures.ts";

// 2026-11-03T00:00:00Z
const NOW = Date.UTC(2026, 10, 3, 0, 0, 0);

const input = (doc: unknown): { doc: unknown; locale: string; nowMs: number } => ({
  doc,
  locale: "en-US",
  nowMs: NOW,
});

const text = (value: string): ResolvedNode => ({
  type: "Text",
  props: { text: value },
  children: [],
});
const badge = (value: string): ResolvedNode => ({
  type: "Badge",
  props: { text: value },
  children: [],
});
const step = (key: string, label: string): ResolvedNode => ({
  type: "Text",
  props: { step: key, text: label },
  children: [],
});
/** 바인드 하나짜리 Text 노드. format이 없으면 경로만 쓴다 */
const boundText = (path: string, format?: "bytes"): UiNode => ({
  type: "Text",
  bind: { text: format === undefined ? { path } : { path, format } },
});

describe("resolveTree on the group-helm inquiry tree", () => {
  test("lenses become one Row per element, and the hidden EmptyState is omitted", () => {
    const resolved = resolveTree(
      loadHelmTree("helm-inquiry.view.json"),
      input(helmInquiryDoc("i1")),
    );
    expect(resolved.issues).toEqual([]);
    expect(resolved.truncated).toEqual(false);
    expect(resolved.root).toEqual({
      type: "Stack",
      props: {},
      children: [
        {
          type: "Section",
          props: { title: "현재 탐구" },
          children: [
            {
              type: "Stepper",
              props: { current: "diverge" },
              children: [
                step("idle", "대기"),
                step("diverge", "발산"),
                step("explore", "다른 분야 탐색"),
                step("converge", "수렴"),
                step("apply", "적용"),
              ],
            },
            {
              type: "Row",
              props: {},
              children: [
                { type: "Badge", props: { text: "held" }, children: [] },
                { type: "Meter", props: { label: "발견 수", max: 24, value: 3 }, children: [] },
              ],
            },
            {
              type: "ActivityTree",
              props: {},
              children: [
                { type: "Row", props: {}, children: [text("A"), badge("run")] },
                { type: "Row", props: {}, children: [text("B"), badge("done")] },
              ],
            },
          ],
        },
        {
          type: "Section",
          props: { title: "발견" },
          children: [
            {
              type: "List",
              props: {},
              children: [{ type: "Row", props: {}, children: [text("c"), badge("high")] }],
            },
          ],
        },
        {
          type: "Section",
          props: { title: "지난 탐구" },
          children: [{ type: "List", props: {}, children: [] }],
        },
        {
          type: "Row",
          props: {},
          children: [
            { type: "Button", props: { label: "탐구 멈춤", command: "helm-stop" }, children: [] },
          ],
        },
      ],
    });
  });

  test("EmptyState appears when the inquiry id is a present null", () => {
    const resolved = resolveTree(
      loadHelmTree("helm-inquiry.view.json"),
      input(helmInquiryDoc(null)),
    );
    expect(resolved.root?.children[0]?.children.at(-1)).toEqual({
      type: "EmptyState",
      props: { text: "진행 중인 탐구가 없습니다" },
      children: [],
    });
  });

  test("with a node limit of 5 the sixth node becomes one too_long placeholder and the rest is dropped", () => {
    const resolved: ResolvedTree = resolveTree(loadHelmTree("helm-inquiry.view.json"), {
      ...input(helmInquiryDoc("i1")),
      limits: { nodes: 5 },
    });
    expect(resolved.truncated).toEqual(true);
    expect(resolved.root).toEqual({
      type: "Stack",
      props: {},
      children: [
        {
          type: "Section",
          props: { title: "현재 탐구" },
          children: [
            {
              type: "Stepper",
              props: { current: "diverge" },
              children: [
                step("idle", "대기"),
                step("diverge", "발산"),
                { type: "Text", props: {}, children: [], placeholder: "too_long" },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("resolveTree structure rules", () => {
  test("a when that is false omits the node; a when that is true keeps it", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        { type: "Text", props: { text: "a" }, when: { path: "/flag", op: "eq", value: true } },
        { type: "Text", props: { text: "b" }, when: { path: "/flag", op: "eq", value: false } },
      ],
    };
    expect(resolveTree(tree, input({ flag: false })).root?.children).toEqual([text("b")]);
  });

  test("a root whose when is false resolves to no root", () => {
    const tree: UiNode = { type: "Stack", when: { path: "/flag", op: "eq", value: true } };
    expect(resolveTree(tree, input({ flag: false }))).toEqual({
      root: undefined,
      issues: [],
      truncated: false,
    });
  });

  test("each over a missing or non-array path yields zero copies", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        { type: "Text", props: { text: "never" }, each: { path: "/missing", as: "x" } },
        { type: "Text", props: { text: "never" }, each: { path: "/notList", as: "x" } },
      ],
    };
    expect(resolveTree(tree, input({ notList: "abc" })).root).toEqual({
      type: "Stack",
      props: {},
      children: [],
    });
  });

  test("each copies see their element under the each name", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        {
          type: "Text",
          each: { path: "/names", as: "name" },
          bind: { text: { path: "/name" } },
        },
      ],
    };
    expect(resolveTree(tree, input({ names: ["a", "b"] })).root?.children).toEqual([
      text("a"),
      text("b"),
    ]);
  });

  test("nested each expands the inner list for each outer element", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        {
          type: "Stack",
          each: { path: "/groups", as: "group" },
          children: [
            {
              type: "Text",
              each: { path: "/group/items", as: "item" },
              bind: { text: { path: "/item" } },
            },
          ],
        },
      ],
    };
    const doc = { groups: [{ items: ["a", "b"] }, { items: ["c"] }] };
    expect(resolveTree(tree, input(doc)).root?.children).toEqual([
      { type: "Stack", props: {}, children: [text("a"), text("b")] },
      { type: "Stack", props: {}, children: [text("c")] },
    ]);
  });

  test("copies that fail their when still spend the work budget, so nested each cannot freeze", () => {
    const leaf: UiNode = {
      type: "Text",
      props: { text: "never" },
      each: { path: "/items", as: "x" },
      when: { path: "/flag", op: "eq", value: true },
    };
    const tree: UiNode = {
      type: "Stack",
      each: { path: "/items", as: "row" },
      children: Array.from({ length: 100 }, () => leaf),
    };
    const items = Array.from({ length: 500 }, (_, index) => index);
    const started = Date.now();
    const resolved = resolveTree(tree, input({ items, flag: false }));
    expect(resolved.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const child of resolved.root?.children ?? []) expect(child.children).toEqual([]);
  });

  test("a root each with several copies is wrapped in one Stack", () => {
    const tree: UiNode = {
      type: "Text",
      each: { path: "/items", as: "item" },
      bind: { text: { path: "/item" } },
    };
    const resolved = resolveTree(tree, input({ items: ["p", "q"] }));
    expect(resolved.root).toEqual({ type: "Stack", props: {}, children: [text("p"), text("q")] });
  });

  test("each copies are capped at 500 and mark the tree truncated", () => {
    const items = Array.from({ length: 600 }, (_, index) => `i${index}`);
    const tree: UiNode = {
      type: "Text",
      each: { path: "/items", as: "item" },
      bind: { text: { path: "/item" } },
    };
    const resolved = resolveTree(tree, input({ items }));
    expect(resolved.root?.children.length).toEqual(500);
    expect(resolved.root?.children.at(-1)).toEqual(text("i499"));
    expect(resolved.truncated).toEqual(true);
  });

  test("an unknown widget becomes one placeholder node and its children are dropped", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        {
          type: "Gizmo",
          children: [{ type: "Text", props: { text: "hidden" } }],
        },
        { type: "Text", props: { text: "shown" } },
      ],
    };
    const resolved = resolveTree(tree, input({}));
    expect(resolved.root?.children).toEqual([
      { type: "Gizmo", props: {}, children: [], placeholder: "unknown_widget" },
      text("shown"),
    ]);
    expect(resolved.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["unknown_widget", "/children/0/type"],
    ]);
  });
});

describe("resolveTree props", () => {
  test("a static prop is kept and a bound value overrides it; a missing bind path keeps the static value", () => {
    const tree: UiNode = {
      type: "Section",
      props: { title: "Static" },
      bind: { title: { path: "/title" } },
    };
    expect(resolveTree(tree, input({ title: "Bound" })).root?.props).toEqual({ title: "Bound" });
    expect(resolveTree(tree, input({})).root?.props).toEqual({ title: "Static" });
  });

  test("bound values: formats apply, and missing, object, array, null and bad-format values omit the prop", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        boundText("/bytes", "bytes"),
        boundText("/missing"),
        boundText("/obj"),
        boundText("/arr"),
        boundText("/nothing"),
        boundText("/word", "bytes"),
      ],
    };
    const doc = { bytes: 1536, obj: { a: 1 }, arr: [1], nothing: null, word: "abc" };
    const resolved = resolveTree(tree, input(doc));
    expect(resolved.root?.children).toEqual([
      { type: "Text", props: { text: "1.5 KiB" }, children: [] },
      { type: "Text", props: {}, children: [] },
      { type: "Text", props: {}, children: [] },
      { type: "Text", props: {}, children: [] },
      { type: "Text", props: {}, children: [] },
      { type: "Text", props: {}, children: [] },
    ]);
    expect(resolved.issues).toEqual([]);
  });

  test("a bound value that does not match the prop kind is dropped and reported at the bind pointer", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [{ type: "Text", bind: { text: { path: "/count" } } }],
    };
    const resolved = resolveTree(tree, input({ count: 3 }));
    expect(resolved.root?.children).toEqual([{ type: "Text", props: {}, children: [] }]);
    expect(resolved.issues).toEqual([
      { code: "prop_type", path: "/children/0/bind/text", message: 'prop "text" must be a string' },
    ]);
  });

  test("a relative time bind uses nowMs", () => {
    const tree: UiNode = {
      type: "Text",
      bind: { text: { path: "/at", format: "relativeTime" } },
    };
    expect(resolveTree(tree, input({ at: NOW - 90_000 })).root?.props).toEqual({
      text: "1 minute ago",
    });
  });

  test("a bind key that is not allowed is dropped, and the checker reports it", () => {
    const tree: UiNode = { type: "Text", bind: { gap: { path: "/x" } } };
    const resolved = resolveTree(tree, input({ x: "v" }));
    expect(resolved.root?.props).toEqual({});
    expect(resolved.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["bind_not_allowed", "/bind/gap"],
    ]);
  });

  test("invalid static props are dropped and reported by the checker", () => {
    const tree: UiNode = { type: "Stack", props: { gap: "xl", color: "red" } };
    const resolved = resolveTree(tree, input({}));
    expect(resolved.root?.props).toEqual({});
    expect(resolved.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["prop_type", "/props/gap"],
      ["forbidden_prop", "/props/color"],
    ]);
  });

  test("a bound string longer than 4096 characters is cut to 4096", () => {
    const tree: UiNode = { type: "Text", bind: { text: { path: "/long" } } };
    const resolved = resolveTree(tree, input({ long: "a".repeat(5000) }));
    expect(resolved.root?.props).toEqual({ text: "a".repeat(4096) });
  });

  test("the cut never leaves half of a surrogate pair", () => {
    const tree: UiNode = { type: "Text", bind: { text: { path: "/long" } } };
    const resolved = resolveTree(tree, input({ long: `${"a".repeat(4095)}\u{1F600}` }));
    expect(resolved.root?.props).toEqual({ text: "a".repeat(4095) });
  });

  test("an unusable locale omits the formatted prop and does not throw", () => {
    const tree: UiNode = { type: "Text", bind: { text: { path: "/n", format: "number" } } };
    const resolved = resolveTree(tree, { doc: { n: 1 }, locale: "not_a_locale!!", nowMs: NOW });
    expect(resolved.root).toEqual({ type: "Text", props: {}, children: [] });
  });
});

describe("resolveTree limits", () => {
  test("a depth limit makes the first node past it one too_long placeholder", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [{ type: "Section", children: [{ type: "Text", props: { text: "deep" } }] }],
    };
    expect(resolveTree(tree, { ...input({}), limits: { depth: 2 } })).toEqual({
      root: {
        type: "Stack",
        props: {},
        children: [
          {
            type: "Section",
            props: {},
            children: [{ type: "Text", props: {}, children: [], placeholder: "too_long" }],
          },
        ],
      },
      issues: [],
      truncated: true,
    });
  });

  test("a tree within the limits is not truncated", () => {
    const tree: UiNode = { type: "Text", props: { text: "small" } };
    expect(resolveTree(tree, { ...input({}), limits: { nodes: 1, depth: 1 } })).toEqual({
      root: text("small"),
      issues: [],
      truncated: false,
    });
  });
});

const listTree = (path: string, type = "List"): UiNode => ({
  type,
  bind: { [type === "Table" ? "rows" : "items"]: { path } },
});
const key = (type: string): string => (type === "Table" ? "rows" : "items");

describe("resolveTree array binds", () => {
  test("a scalar array becomes a list and clips long strings", () => {
    const long = "x".repeat(5000);
    const resolved = resolveTree(
      listTree("/names"),
      input({ names: ["a", 2, true, null, long, Number.NaN, { deep: 1 }.deep] }),
    );
    expect(resolved.root).toEqual({
      type: "List",
      props: {},
      children: [],
      lists: { items: ["a", 2, true, null, "x".repeat(4096), 1] },
    });
  });

  test("objects keep only their own scalar fields and skip prototype keys", () => {
    const rows: unknown = JSON.parse(
      '[{"id":"r1","n":3,"nested":{"a":1},"list":[1],"__proto__":{"polluted":true},"constructor":"c"},[1,2],"s"]',
    );
    const resolved = resolveTree(listTree("/rows", "Table"), input({ rows }));
    expect(resolved.root?.lists).toEqual({ rows: [{ id: "r1", n: 3 }, "s"] });
    const first = resolved.root?.lists?.[key("Table")]?.[0];
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect("polluted" in {}).toBe(false);
  });

  test("lists are capped at 500 and mark the tree truncated", () => {
    const items = Array.from({ length: 600 }, (_, index) => index);
    const resolved = resolveTree(listTree("/items"), input({ items }));
    expect(resolved.truncated).toBe(true);
    expect(resolved.root?.lists?.["items"]).toEqual(items.slice(0, 500));
  });

  test("a non-array value on a list key keeps the old behaviour", () => {
    const scalar = resolveTree(listTree("/v"), input({ v: "text" }));
    expect(scalar.root?.lists).toBeUndefined();
    expect(scalar.root?.props).toEqual({ items: "text" });
    const object = resolveTree(listTree("/v"), input({ v: { a: 1 } }));
    expect(object.root).toEqual({ type: "List", props: {}, children: [] });
  });

  test("list elements spend the shared work budget", () => {
    const items = Array.from({ length: 500 }, (_, index) => index);
    const tree: UiNode = {
      type: "Stack",
      children: Array.from({ length: 100 }, () => listTree("/items")),
    };
    const resolved = resolveTree(tree, input({ items }));
    expect(resolved.truncated).toBe(true);
    const total = (resolved.root?.children ?? []).reduce(
      (sum, child) => sum + (child.lists?.["items"]?.length ?? 0),
      0,
    );
    expect(total).toBe(20000);
  });
});
