import { describe, expect, test } from "bun:test";
import { Bug } from "../../src/index.ts";
import {
  MAX_TOOLS_PER_REQUEST,
  orderTools,
  toolOrderKey,
  type AnyCapabilityDef,
} from "../../src/capabilities/index.ts";
import { makeDef, permutations } from "./helpers.ts";

const DEFS: readonly AnyCapabilityDef[] = [
  makeDef("web.search", ["web_search", "web_fetch"]),
  makeDef("workspace.files", ["read", "ls", "grep"]),
  makeDef("acme-notes.sync", ["notes_sync", "notes_push"]),
];

function names(defs: readonly AnyCapabilityDef[]): string[] {
  return orderTools(defs).map((tool) => `${tool.capability}/${tool.name}`);
}

describe("orderTools", () => {
  test("every permutation of three definitions gives the same list", () => {
    const expected = names(DEFS);
    expect(expected.length).toBe(7);
    for (const permutation of permutations(DEFS)) expect(names(permutation)).toEqual(expected);
  });

  test("tools sort by capability first, then name", () => {
    expect(names(DEFS)).toEqual([
      "acme-notes.sync/notes_push",
      "acme-notes.sync/notes_sync",
      "web.search/web_fetch",
      "web.search/web_search",
      "workspace.files/grep",
      "workspace.files/ls",
      "workspace.files/read",
    ]);
  });

  test("a duplicate (capability, name) is a bug", () => {
    expect(() => orderTools([makeDef("web.one", ["a", "a"])])).toThrow(Bug);
    expect(() => orderTools([makeDef("web.one", ["a"]), makeDef("web.one", ["a"])])).toThrow(Bug);
  });

  test("the wire part carries name, description and parameters only", () => {
    const [first] = orderTools([makeDef("web.one", ["a"])]);
    expect(Object.keys(first?.wire ?? {}).toSorted()).toEqual([
      "description",
      "name",
      "parameters",
    ]);
  });

  test("the per-request tool cap is 128", () => {
    expect(MAX_TOOLS_PER_REQUEST).toBe(128);
  });
});

function key(capability: string, name: string): { capability: string; name: string } {
  return { capability, name };
}

describe("toolOrderKey", () => {
  test("compares by code unit, not locale", () => {
    expect(toolOrderKey(key("web.search", "x"), key("web.search-x", "x"))).toBe(-1);
    expect(toolOrderKey(key("c.a", "a_b"), key("c.a", "ab"))).toBe(-1);
    expect(toolOrderKey(key("c.a", "B"), key("c.a", "a"))).toBe(-1);
    expect(toolOrderKey(key("c.a", "a"), key("c.a", "a"))).toBe(0);
    expect(toolOrderKey(key("c.b", "a"), key("c.a", "z"))).toBe(1);
  });

  test("tools of one capability stay in name order", () => {
    expect(names([makeDef("web.one", ["b", "c", "a"])])).toEqual([
      "web.one/a",
      "web.one/b",
      "web.one/c",
    ]);
  });

  test("tools outside capabilities use the ext. and mcp. key prefixes", () => {
    expect(toolOrderKey(key("ext.acme", "t"), key("mcp.github", "t"))).toBe(-1);
  });
});
