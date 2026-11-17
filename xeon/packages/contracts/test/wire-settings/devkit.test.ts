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

/** 기록 한 건을 감싼다. replay 값은 통째로 넘긴다(일부만 덮으면 빠뜨린 필드가 되살아난다) */
function listOf(replayValue: unknown): unknown {
  return {
    tests: [
      {
        testId: "t2",
        kind: "replay",
        target: "helm",
        state: "failed",
        startedAt: "2026-10-31T00:00:00.000Z",
        durationMs: 10,
        threadId: null,
        replay: replayValue,
      },
    ],
  };
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
    // M5c-1: 종류는 single-plugin만 받는다. plugin-group은 거절한다
    const base = { kind: "single-plugin", name: "my-group", dir: "/tmp/x" };
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
    expect(parse(params, { ...base, kind: "plugin-group" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["ext.scaffold"].result, { dir: "/tmp/x", files: ["plugin.json"] });
  });

  test("ext.validate and ext.package round trip", () => {
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
  });

  test("the removed install, preview and remove methods are gone from the registry", () => {
    const names = ["ext.install", "ext.installPreview", "ext.remove", "ext.removePreview"];
    for (const name of names) {
      expect(Object.keys(WIRE_METHODS)).not.toContain(name);
    }
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
            cuts: [
              { commitIndex: 1, equal: true, firstDiff: null },
              { commitIndex: 2, equal: false, firstDiff: 2 },
              { commitIndex: 3, equal: true, firstDiff: null },
              { commitIndex: 4, equal: true, firstDiff: null },
            ],
            effects: { turn: 1, spawn: 0, delegate: 0, post: 2 },
            failure: null,
          },
        },
      ],
    });
  });

  test("ext.test.list replay carries one cut per commit and rejects a malformed cut", () => {
    const list = WIRE_METHODS["ext.test.list"].result;
    const cut = { commitIndex: 2, equal: false, firstDiff: 2 };
    const replay = {
      ok: false,
      commits: 2,
      passed: 1,
      firstDiff: 2,
      cuts: [{ commitIndex: 1, equal: true, firstDiff: null }, cut],
      effects: { turn: 0, spawn: 0, delegate: 0, post: 0 },
      failure: null,
    };
    roundTrip(list, listOf(replay));
    // 칸이 없으면 거절한다
    const { cuts: _cuts, ...noCuts } = replay;
    expect(parse(list, listOf(noCuts)).ok).toBe(false);
    // 커밋이 없는 실행은 칸도 없다
    roundTrip(list, listOf({ ...replay, cuts: [] }));
    // 커밋 번호는 1부터, 다른 위치는 0 이상이다
    expect(parse(list, listOf({ ...replay, cuts: [{ ...cut, commitIndex: 0 }] })).ok).toBe(false);
    expect(parse(list, listOf({ ...replay, cuts: [{ ...cut, commitIndex: 1.5 }] })).ok).toBe(false);
    expect(parse(list, listOf({ ...replay, cuts: [{ ...cut, firstDiff: -1 }] })).ok).toBe(false);
    expect(parse(list, listOf({ ...replay, cuts: [{ ...cut, extra: true }] })).ok).toBe(false);
    const { equal: _equal, ...noEqual } = cut;
    expect(parse(list, listOf({ ...replay, cuts: [noEqual] })).ok).toBe(false);
    // 칸은 최대 1000개다
    const atCap = Array.from({ length: 1000 }, (_, index) => ({
      commitIndex: index + 1,
      equal: true,
      firstDiff: null,
    }));
    roundTrip(list, listOf({ ...replay, commits: 1000, passed: 1000, cuts: atCap }));
    expect(
      parse(
        list,
        listOf({
          ...replay,
          cuts: [...atCap, { commitIndex: 1001, equal: true, firstDiff: null }],
        }),
      ).ok,
    ).toBe(false);
  });
});
