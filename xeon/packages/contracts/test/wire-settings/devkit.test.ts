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
    roundTrip(WIRE_METHODS["ext.install"].result, {
      name: "n",
      version: "1.0.0",
      location: "/l",
      appliesAt: "restart",
    });
    roundTrip(WIRE_METHODS["ext.install"].result, {
      name: "n",
      version: "1.0.0",
      location: "/l",
      appliesAt: "nextStepBoundary",
      needsReload: true,
    });
    expect(
      parse(WIRE_METHODS["ext.install"].result, {
        name: "n",
        version: "1.0.0",
        location: "/l",
        appliesAt: "nextStepBoundary",
        needsReload: false,
      }).ok,
    ).toBe(false);
    for (const appliesAt of ["now", "nextStepBoundary"]) {
      roundTrip(WIRE_METHODS["ext.install"].result, {
        name: "n",
        version: "1.0.0",
        location: "/l",
        appliesAt,
      });
    }
    // 복사는 됐지만 싣지 못했으면 이유와 진단이 함께 간다
    roundTrip(WIRE_METHODS["ext.install"].result, {
      name: "n",
      version: "1.0.0",
      location: "/l",
      appliesAt: "restart",
      loadFailure: {
        reason: "error",
        diagnostics: [{ severity: "error", code: "entry_import_failed", message: "m" }],
      },
    });
    expect(
      parse(WIRE_METHODS["ext.install"].result, {
        name: "n",
        version: "1.0.0",
        location: "/l",
        appliesAt: "restart",
        loadFailure: { reason: "other", diagnostics: [] },
      }).ok,
    ).toBe(false);
    // 설치는 미리 보기의 해시를 함께 받는다
    const install = WIRE_METHODS["ext.install"].params;
    expect(parse(install, { source: "/s", sha256: "a".repeat(64) }).ok).toBe(true);
    expect(parse(install, { source: "/s" }).ok).toBe(false);
    expect(parse(install, { source: "/s", sha256: "XYZ" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["ext.installPreview"].params, { source: "/s" }).ok).toBe(true);
    roundTrip(WIRE_METHODS["ext.installPreview"].result, {
      name: "n",
      version: "1.0.0",
      displayName: null,
      description: "d",
      source: "/s",
      sha256: "a".repeat(64),
      trustRequest: "user",
      installedVersion: "0.9.0",
      hooks: ["turn.before"],
      tools: [],
      capabilities: [{ id: "web.fetch", optional: false }],
      network: ["web.fetch"],
      files: [],
      shell: [],
      drives: false,
      warnings: [{ severity: "warning", code: "AU-006", path: "/ui", message: "m" }],
    });
    roundTrip(WIRE_METHODS["ext.remove"].result, { name: "n", appliesAt: "restart" });
    roundTrip(WIRE_METHODS["ext.remove"].result, { name: "n", appliesAt: "now" });
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
