import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  DEVKIT_ERROR_KINDS,
  DevkitServiceName,
  EXTENSION_KINDS,
} from "../../src/services/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

const kind = {
  id: "plugin-group",
  title: "kinds.plugin-group",
  layers: ["L3"],
  status: "stable",
  since: "1.0.0",
  requires: { contracts: "^1.0.0" },
  checks: ["AU-001", "AU-003"],
  decisions: ["drives"],
  security: [],
};

describe("fresnel.devkit and its wire methods", () => {
  test("service name, error kinds and the two extension kinds", () => {
    expect(DevkitServiceName).toBe("fresnel.devkit");
    expect(DEVKIT_ERROR_KINDS).toContain("dev_mode_required");
    expect(EXTENSION_KINDS).toEqual(["single-plugin", "plugin-group"]);
  });

  test("ext.kinds returns single-plugin and plugin-group, a blocked kind carries its reason", () => {
    roundTrip(WIRE_METHODS["ext.kinds"].result, {
      kinds: [
        { ...kind, id: "single-plugin", layers: ["L1", "L2", "L3", "plugin"] },
        { ...kind, status: "blocked", blockedReason: "pending N14" },
      ],
    });
    expect(
      parse(WIRE_METHODS["ext.kinds"].result, { kinds: [{ ...kind, status: "wip" }] }).ok,
    ).toBe(false);
    // 옛 plugin·group 종류 이름은 받지 않는다
    expect(parse(WIRE_METHODS["ext.kinds"].result, { kinds: [{ ...kind, id: "group" }] }).ok).toBe(
      false,
    );
    expect(parse(WIRE_METHODS["ext.kinds"].result, { kinds: [{ ...kind, layer: "L3" }] }).ok).toBe(
      false,
    );
  });

  test("ext.scaffold takes group and ui drafts and rejects unknown keys and old names", () => {
    const params = WIRE_METHODS["ext.scaffold"].params;
    const base = { kind: "plugin-group", name: "my-group", dir: "/tmp/x" };
    expect(parse(params, base).ok).toBe(true);
    expect(parse(params, { ...base, group: { members: ["sync"] } }).ok).toBe(true);
    expect(
      parse(params, {
        ...base,
        group: {
          composition: { blocks: [{ id: "m", stage: "machine", op: "drive" }] },
        },
        layer: "L3",
      }).ok,
    ).toBe(true);
    expect(parse(params, { ...base, extra: 1 }).ok).toBe(false);
    expect(parse(params, { ...base, group: { composition: 5 } }).ok).toBe(false);
    expect(parse(params, { ...base, composition: { blocks: [] } }).ok).toBe(false);
    expect(parse(params, { ...base, views: {} }).ok).toBe(false);
    expect(parse(params, { ...base, kind: "group" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["ext.scaffold"].result, { dir: "/tmp/x", files: ["plugin.json"] });
  });

  test("ext.validate, ext.package, ext.install round trip", () => {
    roundTrip(WIRE_METHODS["ext.validate"].result, {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "AU-004",
          path: "/group/composition",
          message: "m",
          file: "a.ts",
          line: 4,
        },
        { severity: "info", code: "AU-008", path: "/ui/items/0", message: "m" },
      ],
    });
    roundTrip(WIRE_METHODS["ext.package"].result, {
      path: "/o.tar",
      files: ["a"],
      sha256: "a".repeat(64),
    });
    expect(
      parse(WIRE_METHODS["ext.package"].result, { path: "/o", files: [], sha256: "XYZ" }).ok,
    ).toBe(false);
    roundTrip(WIRE_METHODS["ext.install"].result, { name: "n", version: "1.0.0", location: "/l" });
    roundTrip(WIRE_METHODS["ext.remove"].result, { name: "n", appliesAt: "restart" });
  });

  test("ext.test.run and ext.test.list round trip, testRun replaces trial", () => {
    const run = WIRE_METHODS["ext.test.run"].params;
    expect(parse(run, { kind: "replay", target: "helm", options: { maxCommits: 10 } }).ok).toBe(
      true,
    );
    expect(parse(run, { kind: "testRun", target: "helm" }).ok).toBe(true);
    expect(parse(run, { kind: "trial", target: "helm" }).ok).toBe(false);
    expect(parse(run, { kind: "bench", target: "helm" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["ext.test.run"].result, { testId: "t1", threadId: null });
    roundTrip(WIRE_METHODS["ext.test.list"].result, {
      tests: [
        {
          testId: "t1",
          kind: "replay",
          target: "helm",
          state: "failed",
          startedAt: "2026-10-31T00:00:00.000Z",
          durationMs: 120,
          threadId: null,
          replay: {
            ok: false,
            commits: 4,
            passed: 3,
            firstDiff: 2,
            effects: { turn: 1, spawn: 0, delegate: 0, post: 2 },
            failure: "effects-mismatch",
          },
        },
      ],
    });
  });
});
