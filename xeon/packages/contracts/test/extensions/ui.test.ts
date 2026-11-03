import { describe, expect, test } from "bun:test";
import {
  BridgePushSchema,
  BridgeReadySchema,
  ExtMethodDeclSchema,
  BridgeRequestSchema,
  BridgeResponseSchema,
  UI_LIMITS,
  bridgeMessageWithinLimit,
  validateManifest,
  validateUiTree,
  type UiNode,
} from "../../src/extensions/index.ts";
import { parse } from "../../src/base/index.ts";
import { codesOf, pluginJson } from "./helpers.ts";

function uiJson(items: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return pluginJson({ ui: { schemaVersion: 1, widgets: "^1.0.0", items, ...extra } });
}
const page = { id: "main", placement: "page", title: "Main", file: "./ui/main.view.json" };
function pageWith(id: string, placement = "page"): Record<string, unknown> {
  return { id, placement, title: "Main", file: "./ui/main.view.json" };
}
const leaf: UiNode = { type: "Text", props: { tone: "muted" } };
function chain(depth: number): UiNode {
  return depth === 1 ? leaf : { type: "Stack", children: [chain(depth - 1)] };
}
const app = {
  reason: "free canvas",
  root: "./ui/graph",
  entry: "index.html",
  bridge: "^1.0.0",
};

describe("manifest ui", () => {
  test("native page without mode defaults and passes", () => {
    const result = validateManifest(uiJson([page]));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.ui?.items[0]?.id).toBe("main");
  });

  test("app page needs app, reason and no file", () => {
    const ok = validateManifest(
      uiJson([{ id: "graph", placement: "page", mode: "app", title: "Graph", app }], {
        widgets: undefined,
      }),
    );
    expect(ok.issues).toEqual([]);
    const empty = validateManifest(
      uiJson([
        { id: "graph", placement: "page", mode: "app", title: "G", app: { ...app, reason: "  " } },
      ]),
    );
    expect(codesOf(empty.issues)).toEqual(["ui_reason_empty"]);
    const missing = validateManifest(
      uiJson([{ id: "graph", placement: "page", mode: "app", title: "G", file: "./a.json" }]),
    );
    expect(codesOf(missing.issues)).toEqual(["ui_invalid", "ui_invalid"]);
  });

  test("card, status and settings only accept native", () => {
    for (const placement of ["card", "status", "settings"]) {
      const result = validateManifest(
        uiJson([{ id: "x", placement, mode: "app", title: "X", forKind: "x.acme-notes.k", app }]),
      );
      expect({ placement, first: codesOf(result.issues)[0] }).toEqual({
        placement,
        first: "ui_mode_not_allowed",
      });
    }
  });

  test("placement counts: page 4, panel 1, one card per kind", () => {
    const pages = ["a", "b", "c", "d", "e"].map((id) => pageWith(id));
    expect(codesOf(validateManifest(uiJson(pages)).issues)).toEqual(["ui_limit"]);
    const panels = ["a", "b"].map((id) => pageWith(id, "panel"));
    expect(codesOf(validateManifest(uiJson(panels)).issues)).toEqual(["ui_limit"]);
    const card = {
      id: "c1",
      placement: "card",
      title: "C",
      file: "./c.json",
      forKind: "x.acme-notes.k",
    };
    const cards = validateManifest(uiJson([card, { ...card, id: "c2" }]));
    expect(codesOf(cards.issues)).toEqual(["ui_limit"]);
    expect(codesOf(validateManifest(uiJson([{ ...card, forKind: undefined }])).issues)).toEqual([
      "ui_invalid",
    ]);
  });

  test("duplicate ids, escaping paths, missing widgets", () => {
    expect(codesOf(validateManifest(uiJson([page, page])).issues)).toEqual(["ui_duplicate"]);
    const escaping = validateManifest(uiJson([{ ...page, file: "../outside.json" }]));
    expect(codesOf(escaping.issues)).toEqual(["ui_path_invalid"]);
    const noWidgets = validateManifest(uiJson([page], { widgets: undefined }));
    expect(codesOf(noWidgets.issues)).toEqual(["widgets_required"]);
  });

  test("methods are extension level: duplicate verbs, readOnly with approval, bad verb", () => {
    const method = { verb: "status", params: {}, result: {}, readOnly: true };
    const dup = validateManifest(pluginJson({ methods: [method, method] }));
    expect(codesOf(dup.issues)).toEqual(["method_duplicate"]);
    expect(dup.issues[0]?.path).toBe("/methods/1/verb");
    const both = validateManifest(pluginJson({ methods: [{ ...method, approval: true }] }));
    expect(codesOf(both.issues)).toEqual(["method_invalid"]);
    const bad = validateManifest(pluginJson({ methods: [{ ...method, verb: "Bad-Verb" }] }));
    expect(codesOf(bad.issues)).toEqual(["method_invalid"]);
    const ok = validateManifest(pluginJson({ methods: [method] }));
    expect(ok.manifest?.methods).toEqual([method]);
  });

  test("old names are rejected: views, declarative, frame, well, cli", () => {
    const views = validateManifest(pluginJson({ views: { schemaVersion: 1, items: [] } }));
    expect(views.issues.map((i) => [i.code, i.path])).toEqual([["legacy_field", "/views"]]);
    for (const old of [
      { mode: "declarative" },
      { mode: "frame", frame: app },
      { placement: "well" },
      { cli: { command: "x" } },
      { slot: "page" },
    ]) {
      const result = validateManifest(uiJson([{ ...page, ...old }]));
      expect({ old, ok: result.manifest !== undefined }).toEqual({ old, ok: false });
    }
  });

  test("a command placement needs no file or widgets", () => {
    const result = validateManifest(
      uiJson([{ id: "go", placement: "command", title: "Go" }], { widgets: undefined }),
    );
    expect(result.issues).toEqual([]);
  });
});

describe("validateUiTree", () => {
  test("accepts bindings, each and when and returns the tree", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [
        {
          type: "List",
          each: { path: "/items", as: "item" },
          when: { path: "/items", op: "exists" },
          children: [{ type: "Text", bind: { text: { path: "/name", format: "duration" } } }],
        },
      ],
    };
    expect(validateUiTree(tree)).toEqual({ ok: true, tree });
  });

  test("rejects CSS-like props, unknown keys and lowercase widget names", () => {
    const style = validateUiTree({ type: "Text", style: "color:red" });
    expect(style.ok).toBe(false);
    const nested = validateUiTree({ type: "Text", props: { color: { r: 1 } } });
    expect(nested.ok).toBe(false);
    const lower = validateUiTree({ type: "text" });
    expect(lower.ok).toBe(false);
    if (!lower.ok) expect(lower.issues[0]?.code).toBe("ui_invalid");
  });

  test("limits: 2000 nodes and depth 24", () => {
    const flat: UiNode = {
      type: "Stack",
      children: Array.from({ length: UI_LIMITS.treeNodes }, () => leaf),
    };
    const tooMany = validateUiTree(flat);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.issues.map((i) => i.code)).toEqual(["ui_limit"]);

    expect(validateUiTree(chain(UI_LIMITS.treeDepth)).ok).toBe(true);
    expect(validateUiTree(chain(UI_LIMITS.treeDepth + 1)).ok).toBe(false);
    expect(
      validateUiTree({
        type: "Stack",
        children: Array.from({ length: UI_LIMITS.treeNodes - 1 }, () => leaf),
      }).ok,
    ).toBe(true);
  });
});

describe("bridge messages", () => {
  test("request, response, push and ready round trip by value", () => {
    const request = { v: 1, id: 7, op: "query", args: { verb: "status" } } as const;
    expect(parse(BridgeRequestSchema, request)).toEqual({ ok: true, value: request });
    const okResponse = { v: 1, id: 7, ok: true, value: [1, 2] } as const;
    expect(parse(BridgeResponseSchema, okResponse)).toEqual({ ok: true, value: okResponse });
    const errResponse = { v: 1, id: 7, ok: false, error: { kind: "op_not_allowed" } } as const;
    expect(parse(BridgeResponseSchema, errResponse)).toEqual({ ok: true, value: errResponse });
    const push = { v: 1, push: "theme", value: { mode: "dark" } } as const;
    expect(parse(BridgePushSchema, push)).toEqual({ ok: true, value: push });
    const ping = { v: 1, push: "ping", value: { n: 3 } } as const;
    expect(parse(BridgePushSchema, ping)).toEqual({ ok: true, value: ping });
    const ready = { v: 1, ready: true, bridge: "^1.0.0" } as const;
    expect(parse(BridgeReadySchema, ready)).toEqual({ ok: true, value: ready });
    const withNonce = { ...ready, nonce: "abcDEF123_-xyz90" };
    expect(parse(BridgeReadySchema, withNonce)).toEqual({ ok: true, value: withNonce });
    expect(parse(BridgeReadySchema, { ...ready, nonce: "short" }).ok).toBe(false);
    expect(parse(BridgeReadySchema, { ...ready, nonce: "x".repeat(65) }).ok).toBe(false);
  });

  test("a method label is 1 to 48 characters", () => {
    const decl = { verb: "start", params: {}, result: {}, readOnly: false };
    expect(parse(ExtMethodDeclSchema, { ...decl, label: "Start a run" }).ok).toBe(true);
    expect(parse(ExtMethodDeclSchema, { ...decl, label: "" }).ok).toBe(false);
    expect(parse(ExtMethodDeclSchema, { ...decl, label: "x".repeat(49) }).ok).toBe(false);
  });

  test("rejects unknown op, wrong version, error without kind, extra keys", () => {
    expect(parse(BridgeRequestSchema, { v: 1, id: 1, op: "eval", args: null }).ok).toBe(false);
    expect(parse(BridgeRequestSchema, { v: 2, id: 1, op: "query", args: null }).ok).toBe(false);
    expect(parse(BridgeResponseSchema, { v: 1, id: 1, ok: false, error: {} }).ok).toBe(false);
    expect(parse(BridgePushSchema, { v: 1, push: "theme", value: 1, extra: 1 }).ok).toBe(false);
  });

  test("size limit is 1 MiB of JSON", () => {
    expect(bridgeMessageWithinLimit({ a: "x".repeat(1000) })).toBe(true);
    expect(bridgeMessageWithinLimit({ a: "x".repeat(UI_LIMITS.bridgeMessageBytes) })).toBe(false);
    expect(bridgeMessageWithinLimit(undefined)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(bridgeMessageWithinLimit(cyclic)).toBe(false);
  });
});
