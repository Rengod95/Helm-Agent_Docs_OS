import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type {
  KindEntry,
  MemberInfo,
  MemberOp,
  MembersEditResult,
} from "@fresnel/contracts/services";
import { WireError } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 제작 처리기(`ext.kinds`, `ext.scaffold`, `ext.validate`, `ext.package`, `ext.validateComposition`)를
// 가짜 포트 위에서 본다. 처리기는 포트 값을 와이어 결과로 옮기고 포트의 실패 값을 정해진 와이어 오류로 바꾼다.
// 포트 구현은 test/assembly/devkit-port.test.ts에서 본다.

const KIND: KindEntry = {
  id: "single-plugin",
  title: "Single plugin",
  layers: ["L1", "L2", "L3", "plugin"],
  status: "stable",
  since: "0.1.0",
  requires: { contracts: "^0.0.0" },
  checks: ["AU-001"],
  decisions: [],
  security: [],
};

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("ext.kinds returns the port's catalog entries", async () => {
  const host = createFakeHost({
    overrides: { devkit: { kinds: () => Promise.resolve([KIND]) } },
  });
  const connection = await open(host);
  expect(await connection.request("ext.kinds", {})).toEqual({ kinds: [KIND] });
  await connection.close();
});

test("ext.scaffold, ext.validate and ext.package hand their params to the port and return its value", async () => {
  const seen: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      devkit: {
        scaffold: (input) => {
          seen.push(["scaffold", input]);
          return Promise.resolve(ok({ dir: input.dir, files: [".fresnel-plugin/plugin.json"] }));
        },
        validate: (dir) => {
          seen.push(["validate", dir]);
          return Promise.resolve(
            ok({
              ok: false,
              issues: [{ severity: "error", code: "AU-002", path: "/trust/level", message: "m" }],
            }),
          );
        },
        pack: (input) => {
          seen.push(["pack", input]);
          return Promise.resolve(ok({ path: "/out", files: ["a"], sha256: "a".repeat(64) }));
        },
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("ext.scaffold", { kind: "single-plugin", name: "demo", dir: "/d" }),
  ).toEqual({ dir: "/d", files: [".fresnel-plugin/plugin.json"] });
  expect(await connection.request("ext.validate", { dir: "/d" })).toEqual({
    ok: false,
    issues: [{ severity: "error", code: "AU-002", path: "/trust/level", message: "m" }],
  });
  expect(await connection.request("ext.package", { dir: "/d", out: "/o" })).toEqual({
    path: "/out",
    files: ["a"],
    sha256: "a".repeat(64),
  });
  expect(seen).toEqual([
    ["scaffold", { kind: "single-plugin", name: "demo", dir: "/d" }],
    ["validate", "/d"],
    ["pack", { dir: "/d", out: "/o" }],
  ]);
  await connection.close();
});

test("ext.validateComposition returns the port's issues", async () => {
  const host = createFakeHost({
    overrides: {
      devkit: {
        validateComposition: (params) => ({
          issues: [
            {
              severity: "error",
              code: "composition_block_duplicate",
              path: "/blocks/1/id",
              message: `blocks: ${String(params.composition.blocks.length)}`,
            },
          ],
        }),
      },
    },
  });
  const connection = await open(host);
  const result = await connection.request("ext.validateComposition", {
    composition: {
      blocks: [
        { id: "a", stage: "s", op: "post" },
        { id: "a", stage: "s", op: "post" },
      ],
    },
  });
  expect(result).toEqual({
    issues: [
      {
        severity: "error",
        code: "composition_block_duplicate",
        path: "/blocks/1/id",
        message: "blocks: 2",
      },
    ],
  });
  await connection.close();
});

test("a port failure becomes the wire error of the table: input problems are invalidParams with the path, io is store.io", async () => {
  const host = createFakeHost({
    overrides: {
      devkit: {
        scaffold: () => Promise.resolve(err({ kind: "exists", message: "/d is not empty" })),
        validate: () => Promise.resolve(err({ kind: "not_found", message: "no manifest" })),
        pack: () => Promise.resolve(err({ kind: "io", message: "disk" })),
      },
    },
  });
  const connection = await open(host);
  const exists = await wireErrorOf(
    connection.request("ext.scaffold", { kind: "single-plugin", name: "demo", dir: "/d" }),
  );
  expect(exists.data).toMatchObject({
    kind: "jsonrpc.invalidParams",
    details: { issues: [{ path: "/dir", message: "exists: /d is not empty" }] },
  });
  const missing = await wireErrorOf(connection.request("ext.validate", { dir: "/d" }));
  expect(missing.data).toMatchObject({
    details: { issues: [{ path: "/dir", message: "not_found: no manifest" }] },
  });
  const io = await wireErrorOf(connection.request("ext.package", { dir: "/d" }));
  expect(io.data).toMatchObject({ kind: "store.io" });
  await connection.close();
});

test("host.hello lists the authoring methods, the test run pair included, as features", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  for (const name of [
    "ext.kinds",
    "ext.scaffold",
    "ext.validate",
    "ext.package",
    "ext.validateComposition",
    "ext.test.run",
    "ext.test.list",
    "ext.members.edit",
    "ext.members.read",
  ])
    expect(names).toContain(name);
  // 설치와 지우기는 검토 흐름으로 대체되어 처리기가 없다(M5c §7.7)
  for (const removed of ["ext.install", "ext.installPreview", "ext.remove", "ext.removePreview"])
    expect(names).not.toContain(removed);
  await connection.close();
});

const RECORD = {
  testId: "t-1",
  kind: "replay",
  target: "demo",
  state: "passed",
  startedAt: "2026-11-04T00:00:00.000Z",
  durationMs: 3,
  threadId: null,
  replay: {
    ok: true,
    commits: 1,
    passed: 1,
    firstDiff: null,
    cuts: [{ commitIndex: 1, equal: true, firstDiff: null }],
    effects: { turn: 1, spawn: 0, delegate: 0, post: 0 },
    failure: null,
  },
} as const;

test("ext.test.run hands its params to the port and returns the port's value; ext.test.list returns the port's records", async () => {
  const seen: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      devkit: {
        testRun: (params) => {
          seen.push(params);
          return Promise.resolve(ok({ testId: "t-1", threadId: null }));
        },
        testList: () => Promise.resolve(ok({ tests: [RECORD] })),
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("ext.test.run", {
      kind: "replay",
      target: "demo",
      options: { maxCommits: 50 },
    }),
  ).toEqual({ testId: "t-1", threadId: null });
  expect(seen).toEqual([{ kind: "replay", target: "demo", options: { maxCommits: 50 } }]);
  expect(await connection.request("ext.test.list", {})).toEqual({ tests: [RECORD] });
  await connection.close();
});

test("ext.test.run maps the dev gate, an unknown target and a busy replay to invalidParams at /target, and a store failure to store.io", async () => {
  const host = createFakeHost({
    overrides: {
      devkit: {
        testRun: (params) => {
          if (params.target === "gated") {
            return Promise.resolve(
              err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
            );
          }
          if (params.target === "missing") {
            return Promise.resolve(err({ kind: "not_found", message: "missing is not installed" }));
          }
          return Promise.resolve(
            err({
              kind: "denied",
              message: "another replay is running; replays run one at a time",
            }),
          );
        },
        testList: () => Promise.resolve(err({ kind: "io", message: "ext-tests.json is damaged" })),
      },
    },
  });
  const connection = await open(host);
  const gated = await wireErrorOf(
    connection.request("ext.test.run", { kind: "replay", target: "gated" }),
  );
  expect(gated.data).toMatchObject({
    kind: "jsonrpc.invalidParams",
    details: {
      issues: [
        { path: "/target", message: "dev_mode_required: replay runs only in development mode" },
      ],
    },
  });
  const unknown = await wireErrorOf(
    connection.request("ext.test.run", { kind: "replay", target: "missing" }),
  );
  expect(unknown.data).toMatchObject({
    details: { issues: [{ path: "/target", message: "not_found: missing is not installed" }] },
  });
  const busy = await wireErrorOf(
    connection.request("ext.test.run", { kind: "replay", target: "demo" }),
  );
  expect(busy.data).toMatchObject({
    details: {
      issues: [
        {
          path: "/target",
          message: "denied: another replay is running; replays run one at a time",
        },
      ],
    },
  });
  const io = await wireErrorOf(connection.request("ext.test.list", {}));
  expect(io.data).toMatchObject({ kind: "store.io" });
  await connection.close();
});

const MEMBER: MemberInfo = {
  id: "sync",
  registrationId: "demo/sync",
  title: null,
  layer: "L3",
  hooks: ["boundary.settle.after"],
  drives: false,
  defaultEnabled: false,
  blockIds: [],
};

test("ext.members.edit and ext.members.read hand their params to the port and return its value", async () => {
  const seen: unknown[] = [];
  const edited: MembersEditResult = {
    members: [MEMBER],
    issues: [],
    changedFiles: ["src/members/sync.ts", ".fresnel-plugin/plugin.json"],
    entryWiring: "manual",
  };
  const host = createFakeHost({
    overrides: {
      devkit: {
        editMembers: (input) => {
          seen.push(["edit", input]);
          return Promise.resolve(ok(edited));
        },
        readMembers: (dir) => {
          seen.push(["read", dir]);
          return Promise.resolve(ok([MEMBER]));
        },
      },
    },
  });
  const connection = await open(host);
  const ops: MemberOp[] = [{ kind: "add", id: "sync", mode: "hook" }];
  expect(await connection.request("ext.members.edit", { dir: "/d", ops })).toEqual(edited);
  expect(await connection.request("ext.members.read", { dir: "/d" })).toEqual({
    members: [MEMBER],
  });
  expect(seen).toEqual([
    ["edit", { dir: "/d", ops }],
    ["read", "/d"],
  ]);
  await connection.close();
});

test("ext.members.edit maps a refusal to invalidParams at /dir with its reasons, and an unknown error to store.io", async () => {
  const host = createFakeHost({
    overrides: {
      devkit: {
        editMembers: (input) =>
          Promise.resolve(
            input.dir === "/installed"
              ? err({ kind: "denied", message: "installed copy" })
              : err({
                  kind: "invalid_input",
                  message: "plugins.json would not validate: plugin_id_invalid",
                  reasons: [{ code: "plugin_id_invalid", field: "plugins/1/id" }],
                }),
          ),
        readMembers: () => Promise.resolve(err({ kind: "io", message: "disk" })),
      },
    },
  });
  const connection = await open(host);
  const denied = await wireErrorOf(
    connection.request("ext.members.edit", {
      dir: "/installed",
      ops: [{ kind: "remove", id: "sync" }],
    }),
  );
  expect(denied.data).toMatchObject({
    kind: "jsonrpc.invalidParams",
    details: { issues: [{ path: "/dir", message: "denied: installed copy" }] },
  });
  const invalid = await wireErrorOf(
    connection.request("ext.members.edit", { dir: "/d", ops: [{ kind: "add", id: "sync" }] }),
  );
  expect(invalid.data).toMatchObject({
    kind: "jsonrpc.invalidParams",
    details: {
      issues: [
        {
          path: "/dir",
          message: "invalid_input: plugins.json would not validate: plugin_id_invalid",
        },
      ],
      reasons: [{ code: "plugin_id_invalid", field: "plugins/1/id" }],
    },
  });
  const io = await wireErrorOf(connection.request("ext.members.read", { dir: "/d" }));
  expect(io.data).toMatchObject({ kind: "store.io" });
  await connection.close();
});

test("ext.members.edit rejects an empty or oversized op list and an unknown op kind before the port runs", async () => {
  const seen: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      devkit: {
        editMembers: (input) => {
          seen.push(input);
          return Promise.resolve(err({ kind: "io", message: "not reached" }));
        },
      },
    },
  });
  const connection = await open(host);
  const remove: MemberOp = { kind: "remove", id: "aa" };
  const empty: MemberOp[] = [];
  const oversized: MemberOp[] = Array.from({ length: 33 }, () => remove);
  // @ts-expect-error -- 알 수 없는 종류는 타입이 거절한다. 실행해도 스키마가 거절하는지 함께 본다(시험, TY-08)
  const unknownKind: MemberOp[] = [{ kind: "replace", id: "aa" }];
  const refusals = await Promise.all(
    [empty, oversized, unknownKind].map((ops) =>
      wireErrorOf(connection.request("ext.members.edit", { dir: "/d", ops })),
    ),
  );
  expect(refusals.map((refused) => refused.data.kind)).toEqual([
    "jsonrpc.invalidParams",
    "jsonrpc.invalidParams",
    "jsonrpc.invalidParams",
  ]);
  expect(seen).toEqual([]);
  await connection.close();
});
