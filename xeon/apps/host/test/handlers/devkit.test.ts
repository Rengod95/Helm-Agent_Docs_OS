import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { KindEntry } from "@fresnel/contracts/services";
import { WireError } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 제작 처리기(`ext.kinds`, `ext.scaffold`, `ext.validate`, `ext.package`, `ext.install`, `ext.remove`, `ext.validateComposition`)를
// 가짜 포트 위에서 본다. 처리기는 포트 값을 와이어 결과로 옮기고 포트의 실패 값을 정해진 와이어 오류로 바꾼다.
// 포트 구현은 test/assembly/devkit-port.test.ts, 실제 엔진은 test/int/devkit.int.test.ts다.

const KIND: KindEntry = {
  id: "plugin-group",
  title: "Plugin group",
  layers: ["L3"],
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

test("ext.scaffold, ext.validate, ext.package and ext.install hand their params to the port and return its value", async () => {
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
        install: (input) => {
          seen.push(["install", input]);
          return Promise.resolve(ok({ name: "demo", version: "0.1.0", location: "/ext/demo" }));
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
  expect(await connection.request("ext.install", { source: "/out" })).toEqual({
    name: "demo",
    version: "0.1.0",
    location: "/ext/demo",
  });
  expect(seen).toEqual([
    ["scaffold", { kind: "single-plugin", name: "demo", dir: "/d" }],
    ["validate", "/d"],
    ["pack", { dir: "/d", out: "/o" }],
    ["install", { source: "/out" }],
  ]);
  await connection.close();
});

test("ext.remove returns when the removal applies, and an unknown name is extension.notFound", async () => {
  const host = createFakeHost({
    overrides: {
      devkit: {
        remove: (name) =>
          Promise.resolve(
            name === "demo"
              ? ok({ name, appliesAt: "nextStepBoundary" })
              : err({ kind: "not_found", message: "no such extension" }),
          ),
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("ext.remove", { name: "demo" })).toEqual({
    name: "demo",
    appliesAt: "nextStepBoundary",
  });
  const missing = await wireErrorOf(connection.request("ext.remove", { name: "ghost" }));
  expect(missing.data).toMatchObject({ kind: "extension.notFound" });
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
        install: () => Promise.resolve(err({ kind: "denied", message: "builtin" })),
      },
    },
  });
  const connection = await open(host);
  const exists = await wireErrorOf(
    connection.request("ext.scaffold", { kind: "plugin-group", name: "demo", dir: "/d" }),
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
  const denied = await wireErrorOf(connection.request("ext.install", { source: "/s" }));
  expect(denied.data).toMatchObject({
    details: { issues: [{ path: "/source", message: "denied: builtin" }] },
  });
  await connection.close();
});

test("host.hello lists the seven authoring methods as features and leaves ext.test.run and ext.test.list out", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  for (const name of [
    "ext.kinds",
    "ext.scaffold",
    "ext.validate",
    "ext.package",
    "ext.install",
    "ext.remove",
    "ext.validateComposition",
  ])
    expect(names).toContain(name);
  expect(names).not.toContain("ext.test.run");
  expect(names).not.toContain("ext.test.list");
  await connection.close();
});
