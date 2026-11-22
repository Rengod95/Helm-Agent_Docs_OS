import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  DEVKIT_ERROR_KINDS,
  DevkitServiceName,
  EXTENSION_KINDS,
} from "../../src/services/index.ts";
import { classifyMethodName, WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

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
  id: "single-plugin",
  title: "kinds.single-plugin",
  layers: ["L1", "L2", "L3", "plugin"],
  status: "stable",
  since: "1.0.0",
  requires: { contracts: "^1.0.0" },
  checks: ["AU-001", "AU-003"],
  decisions: ["layer"],
  security: [],
};

/** 구성원 편집 건 `count`개(id는 규칙에 맞는 값이다: 한 글자 id는 PluginIdSchema가 거절한다) */
function removes(count: number): unknown[] {
  return Array.from({ length: count }, () => ({ kind: "remove", id: "aa" }));
}

/** 의존 줄을 빼는 건 `count`개(대상은 `base-kit`) */
function dependencyRemoves(count: number): unknown[] {
  return Array.from({ length: count }, () => ({ kind: "remove", plugin: "base-kit" }));
}

describe("fresnel.devkit and its wire methods", () => {
  test("service name, error kinds and the one extension kind", () => {
    expect(DevkitServiceName).toBe("fresnel.devkit");
    expect(DEVKIT_ERROR_KINDS).toContain("dev_mode_required");
    expect(EXTENSION_KINDS).toEqual(["single-plugin"]);
  });

  test("ext.kinds returns the single-plugin kind, a blocked kind carries its reason", () => {
    roundTrip(WIRE_METHODS["ext.kinds"].result, {
      kinds: [kind, { ...kind, status: "blocked", blockedReason: "pending N14" }],
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
    // 종류는 single-plugin만 받는다
    const base = { kind: "single-plugin", name: "my-group", dir: "/tmp/x" };
    expect(parse(params, base).ok).toBe(true);
    expect(parse(params, { ...base, orchestration: { members: ["sync"] } }).ok).toBe(true);
    expect(
      parse(params, {
        ...base,
        orchestration: {
          composition: { blocks: [{ id: "m", stage: "machine", op: "drive" }] },
        },
        layer: "L3",
      }).ok,
    ).toBe(true);
    expect(parse(params, { ...base, extra: 1 }).ok).toBe(false);
    expect(parse(params, { ...base, orchestration: { composition: 5 } }).ok).toBe(false);
    expect(parse(params, { ...base, composition: { blocks: [] } }).ok).toBe(false);
    expect(parse(params, { ...base, views: {} }).ok).toBe(false);
    expect(parse(params, { ...base, kind: "group" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["ext.scaffold"].result, { dir: "/tmp/x", files: ["plugin.json"] });
  });

  test("ext.validate and ext.package round trip", () => {
    roundTrip(WIRE_METHODS["ext.validate"].result, {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "AU-004",
          path: "/orchestration/composition",
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

  test("ext.members.edit takes 1 to 32 typed ops and rejects unknown kinds, extra keys and bad values", () => {
    const params = WIRE_METHODS["ext.members.edit"].params;
    const base = { dir: "/tmp/x" };
    // 네 가지 건 모두 받는다
    expect(
      parse(params, {
        ...base,
        ops: [
          { kind: "add", id: "sync", layer: "L3", title: "Sync", mode: "drive" },
          { kind: "rename", id: "sync", to: "sync-2" },
          { kind: "remove", id: "sync-2" },
          { kind: "move", id: "guard", toIndex: 0 },
        ],
      }).ok,
    ).toBe(true);
    expect(parse(params, { ...base, ops: [{ kind: "add", id: "sync" }] }).ok).toBe(true);
    // 건수는 1~32
    expect(parse(params, { ...base, ops: [] }).ok).toBe(false);
    // 건수 경계만 본다: id는 규칙에 맞는 값을 쓴다(한 글자 id는 PluginIdSchema가 거절한다)
    expect(parse(params, { ...base, ops: removes(33) }).ok).toBe(false);
    expect(parse(params, { ...base, ops: removes(32) }).ok).toBe(true);
    expect(parse(params, { ...base, ops: [{ kind: "remove", id: "a" }] }).ok).toBe(false);
    // 알 수 없는 종류, 닫힌 객체, 틀린 값
    expect(parse(params, { ...base, ops: [{ kind: "replace", id: "sync" }] }).ok).toBe(false);
    expect(parse(params, { ...base, ops: [{ kind: "add", id: "sync", extra: 1 }] }).ok).toBe(false);
    expect(parse(params, { ...base, ops: [{ kind: "add", id: "Bad_Name" }] }).ok).toBe(false);
    expect(parse(params, { ...base, ops: [{ kind: "add", id: "sync", layer: "L9" }] }).ok).toBe(
      false,
    );
    expect(parse(params, { ...base, ops: [{ kind: "add", id: "sync", mode: "bogus" }] }).ok).toBe(
      false,
    );
    expect(parse(params, { ...base, ops: [{ kind: "move", id: "sync", toIndex: -1 }] }).ok).toBe(
      false,
    );
    expect(parse(params, { ...base, ops: [{ kind: "move", id: "sync", toIndex: 1.5 }] }).ok).toBe(
      false,
    );
    expect(parse(params, { ...base, ops: [{ kind: "rename", id: "sync" }] }).ok).toBe(false);
    // 바깥 객체: dir과 ops는 필수이고 모르는 키는 거절한다
    expect(parse(params, { ops: [{ kind: "remove", id: "a" }] }).ok).toBe(false);
    expect(parse(params, { dir: "/tmp/x" }).ok).toBe(false);
    expect(parse(params, { ...base, ops: [{ kind: "remove", id: "a" }], out: "/o" }).ok).toBe(
      false,
    );
  });

  test("ext.members.edit and ext.members.read return the member summaries; the registry names are core", () => {
    const member = {
      id: "sync",
      registrationId: "demo/sync",
      title: null,
      layer: "L3",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: ["b1"],
    };
    roundTrip(WIRE_METHODS["ext.members.edit"].result, {
      members: [member],
      issues: [
        {
          severity: "info",
          code: "member_file_kept",
          path: "",
          file: "src/members/a.ts",
          message: "m",
        },
      ],
      changedFiles: ["src/members/sync.ts", ".fresnel-plugin/plugin.json"],
      entryWiring: "generated",
    });
    expect(
      parse(WIRE_METHODS["ext.members.edit"].result, {
        members: [],
        issues: [],
        changedFiles: [],
        entryWiring: "maybe",
      }).ok,
    ).toBe(false);
    // 구성원 요약의 등록 id는 등록 id 규칙을 따른다(대문자는 거절)
    expect(
      parse(WIRE_METHODS["ext.members.edit"].result, {
        members: [{ ...member, registrationId: "Demo/Sync" }],
        issues: [],
        changedFiles: [],
        entryWiring: "manual",
      }).ok,
    ).toBe(false);
    roundTrip(WIRE_METHODS["ext.members.read"].result, { members: [member] });
    expect(parse(WIRE_METHODS["ext.members.read"].params, { dir: "/tmp/x" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.members.read"].params, {}).ok).toBe(false);
    // 세 마디 이름이지만 확장 메서드가 아니라 코어 메서드다(확장 이름 `members`는 예약이다)
    expect(classifyMethodName("ext.members.edit")).toBe("core");
    expect(classifyMethodName("ext.members.read")).toBe("core");
  });

  test("ext.members.detach takes a member and a new folder, and returns the new folder with its profile move", () => {
    const params = WIRE_METHODS["ext.members.detach"].params;
    const input = { dir: "/work/pilot", member: "sync", outDir: "/work/pilot-sync" };
    expect(parse(params, input).ok).toBe(true);
    expect(
      parse(params, {
        ...input,
        name: "sync-kit",
        keepDependency: true,
        dependencyKind: "hard",
      }).ok,
    ).toBe(true);
    // 방식 이름이나 빈 구성원 id, 알 수 없는 키는 거절한다
    expect(parse(params, { ...input, dependencyKind: "maybe" }).ok).toBe(false);
    expect(parse(params, { ...input, member: "" }).ok).toBe(false);
    expect(parse(params, { ...input, extra: true }).ok).toBe(false);
    expect(parse(params, { dir: "/work/pilot", member: "sync" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["ext.members.detach"].result, {
      outDir: "/work/pilot-sync",
      name: "pilot-sync",
      changedFiles: [".fresnel-plugin/plugin.json", "src/index.ts", "src/root.ts"],
      issues: [],
      profileMove: { from: "pilot/sync", to: "pilot-sync" },
    });
    expect(
      parse(WIRE_METHODS["ext.members.detach"].result, {
        outDir: "/work/pilot-sync",
        name: "pilot-sync",
        changedFiles: [],
        issues: [],
        profileMove: { from: "pilot/sync" },
      }).ok,
    ).toBe(false);
    expect(classifyMethodName("ext.members.detach")).toBe("core");
    expect(WIRE_METHODS["ext.members.detach"].stage).toBe("M4");
  });

  test("ext.members.merge takes 2 to 16 folders and a new name, and returns the new folder with its members and profile moves", () => {
    const params = WIRE_METHODS["ext.members.merge"].params;
    const input = { dirs: ["/work/alpha", "/work/beta"], outDir: "/work/pair", name: "pair" };
    expect(parse(params, input).ok).toBe(true);
    expect(parse(params, { ...input, title: "Pair" }).ok).toBe(true);
    expect(
      parse(params, {
        ...input,
        dirs: Array.from({ length: 16 }, (_folder, at) => `/work/m${at}`),
      }).ok,
    ).toBe(true);
    // 폴더가 하나뿐이거나 열일곱이면, 이름이 없으면, 알 수 없는 키나 긴 제목이면 거절한다
    expect(parse(params, { ...input, dirs: ["/work/alpha"] }).ok).toBe(false);
    expect(
      parse(params, {
        ...input,
        dirs: Array.from({ length: 17 }, (_folder, at) => `/work/m${at}`),
      }).ok,
    ).toBe(false);
    expect(parse(params, { dirs: input.dirs, outDir: input.outDir }).ok).toBe(false);
    expect(parse(params, { ...input, extra: true }).ok).toBe(false);
    expect(parse(params, { ...input, title: "t".repeat(65) }).ok).toBe(false);
    const merged = {
      id: "alpha",
      registrationId: "pair/alpha",
      title: null,
      layer: "plugin",
      hooks: [],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
    };
    roundTrip(WIRE_METHODS["ext.members.merge"].result, {
      outDir: "/work/pair",
      name: "pair",
      members: [merged],
      changedFiles: [".fresnel-plugin/plugin.json"],
      issues: [],
      profileMove: [{ from: "alpha", to: "pair/alpha" }],
    });
    expect(
      parse(WIRE_METHODS["ext.members.merge"].result, {
        outDir: "/work/pair",
        name: "pair",
        members: [merged],
        changedFiles: [],
        issues: [],
        profileMove: [{ from: "alpha" }],
      }).ok,
    ).toBe(false);
    expect(classifyMethodName("ext.members.merge")).toBe("core");
    expect(WIRE_METHODS["ext.members.merge"].stage).toBe("M4");
  });

  test("ext.dependencies.edit takes 1 to 32 typed ops and rejects unknown kinds, extra keys and bad values", () => {
    const params = WIRE_METHODS["ext.dependencies.edit"].params;
    const base = { dir: "/tmp/x" };
    // 두 종류 모두 받는다. 구성원 `from`, 범위, 종류는 선택이다. 대상은 확장 이름이나 `이름/id`다
    expect(
      parse(params, {
        ...base,
        ops: [
          {
            kind: "add",
            from: "sync",
            dependency: { plugin: "base-kit", range: "^1.0.0", kind: "hard" },
          },
          { kind: "add", dependency: { plugin: "base-kit/drive" } },
          { kind: "remove", plugin: "base-kit" },
          { kind: "remove", from: "sync", plugin: "base-kit/drive" },
        ],
      }).ok,
    ).toBe(true);
    // 건수는 1~32
    expect(parse(params, { ...base, ops: [] }).ok).toBe(false);
    expect(parse(params, { ...base, ops: dependencyRemoves(33) }).ok).toBe(false);
    expect(parse(params, { ...base, ops: dependencyRemoves(32) }).ok).toBe(true);
    // 알 수 없는 종류, 닫힌 객체, 틀린 값
    expect(parse(params, { ...base, ops: [{ kind: "replace", plugin: "base-kit" }] }).ok).toBe(
      false,
    );
    expect(
      parse(params, {
        ...base,
        ops: [{ kind: "add", dependency: { plugin: "base-kit", extra: 1 } }],
      }).ok,
    ).toBe(false);
    expect(
      parse(params, { ...base, ops: [{ kind: "add", dependency: { plugin: "Base_Kit" } }] }).ok,
    ).toBe(false);
    expect(
      parse(params, {
        ...base,
        ops: [{ kind: "add", dependency: { plugin: "base-kit", kind: "maybe" } }],
      }).ok,
    ).toBe(false);
    expect(
      parse(params, {
        ...base,
        ops: [{ kind: "add", from: "Bad_Name", dependency: { plugin: "base-kit" } }],
      }).ok,
    ).toBe(false);
    expect(
      parse(params, { ...base, ops: [{ kind: "remove", plugin: "base-kit", range: "^1" }] }).ok,
    ).toBe(false);
    expect(parse(params, { ...base, ops: [{ kind: "add" }] }).ok).toBe(false);
    // 바깥 객체: dir과 ops는 필수이고 모르는 키는 거절한다
    expect(parse(params, { dir: "/tmp/x" }).ok).toBe(false);
    expect(
      parse(params, { ...base, ops: [{ kind: "remove", plugin: "base-kit" }], out: "/o" }).ok,
    ).toBe(false);
  });

  test("ext.dependencies.edit and ext.dependencies.read return the dependency lines", () => {
    const line = { from: "demo/sync", target: "base-kit", kind: "hard", range: "^1.0.0" };
    roundTrip(WIRE_METHODS["ext.dependencies.edit"].result, {
      dependencies: [line, { from: "demo", target: "base-kit/drive", kind: "soft", range: null }],
      issues: [{ severity: "info", code: "x", path: "", message: "m" }],
      changedFiles: [".fresnel-plugin/plugin.json"],
    });
    expect(
      parse(WIRE_METHODS["ext.dependencies.edit"].result, {
        dependencies: [{ ...line, kind: "maybe" }],
        issues: [],
        changedFiles: [],
      }).ok,
    ).toBe(false);
    // 등록 id 규칙을 따른다(대문자는 거절)
    expect(
      parse(WIRE_METHODS["ext.dependencies.edit"].result, {
        dependencies: [{ ...line, from: "Demo/Sync" }],
        issues: [],
        changedFiles: [],
      }).ok,
    ).toBe(false);
    roundTrip(WIRE_METHODS["ext.dependencies.read"].result, { dependencies: [line] });
    expect(parse(WIRE_METHODS["ext.dependencies.read"].params, { dir: "/tmp/x" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.dependencies.read"].params, {}).ok).toBe(false);
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
