import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import type { DevkitPort } from "../../src/handlers/m4/devkit.ts";
import {
  authoringDepsOf,
  authoringLoaded,
  authoringUnit,
  devkitServiceOf,
  type AuthoringWiring,
} from "../../src/assembly/authoring.ts";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import { partial } from "../fixtures/unsafe.ts";

// 제작 그룹의 내장 등록(`assembly/authoring.ts`). 기본 꺼짐, 안전 모드와 기본 그룹 끄기에서는 싣지 않음, wire 포트를 서비스 계약으로 맞춤.

function wiringOf(
  port: DevkitPort | undefined,
  devMode: () => boolean = () => false,
): AuthoringWiring {
  return { devkit: () => port, devMode, workspaceOf: () => undefined };
}

test("authoring unit: a builtin L3 group that stays off by default", () => {
  const unit = authoringUnit(wiringOf(undefined), 7);
  expect(unit.manifest.name).toBe("authoring");
  expect(unit.manifest.defaultEnabled).toBe(false);
  expect(unit.manifest.trust).toEqual({ level: "builtin" });
  expect(unit.builtin).toBe(true);
  expect(unit.loadIndex).toBe(7);
});

test("the group's devMode follows the live l3.authoring.devMode value of the catalog, and is off when the value is not true", () => {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const settings = createSettingsEngine(built.catalog);
  const deps = authoringDepsOf(
    wiringOf(undefined, () => settings.value("l3.authoring.devMode") === true),
  );
  expect(deps.devMode?.()).toBe(false);
  settings.setUserValue("l3.authoring.devMode", true);
  expect(deps.devMode?.()).toBe(true);
  settings.setUserValue("l3.authoring.devMode", "true");
  expect(deps.devMode?.()).toBe(false);
  settings.setUserValue("l3.authoring.devMode", undefined);
  expect(deps.devMode?.()).toBe(false);
});

test("authoring is loaded unless default groups are off or the engine is in safe mode", () => {
  expect(authoringLoaded({ defaultGroups: undefined, safeMode: undefined })).toBe(true);
  expect(authoringLoaded({ defaultGroups: true, safeMode: false })).toBe(true);
  expect(authoringLoaded({ defaultGroups: false, safeMode: undefined })).toBe(false);
  expect(authoringLoaded({ defaultGroups: undefined, safeMode: true })).toBe(false);
});

test("the service forwards to the wire port and maps install to link", async () => {
  const calls: string[] = [];
  const port = partial<DevkitPort>({
    kinds: async () => [],
    scaffold: async (input) => {
      calls.push(`scaffold:${input.dir}`);
      return ok({ dir: input.dir, files: ["a"] });
    },
    validate: async (dir) => {
      calls.push(`validate:${dir}`);
      return ok({ ok: true, issues: [] });
    },
    validateComposition: () => ({
      issues: [{ severity: "error", code: "x", path: "/p", message: "m" }],
    }),
    pack: async (input) => {
      calls.push(`pack:${input.dir}`);
      return ok({ path: "/out", files: ["a"], sha256: "a".repeat(64) });
    },
    install: async (input) => {
      calls.push(`install:${input.source}`);
      return ok({ name: "demo", version: "0.1.0", location: "/ext/demo", appliesAt: "restart" });
    },
  });
  const service = devkitServiceOf(wiringOf(port));
  expect(await service.scaffold({ kind: "plugin-group", name: "demo", dir: "/w/demo" })).toEqual(
    ok({ dir: "/w/demo", files: ["a"] }),
  );
  expect(await service.validate("/w/demo")).toEqual(ok({ ok: true, issues: [] }));
  expect(service.validateComposition({ blocks: [{ id: "a", stage: "run", op: "drive" }] })).toEqual(
    {
      ok: false,
      issues: [{ severity: "error", code: "x", path: "/p", message: "m" }],
    },
  );
  expect(await service.pack({ dir: "/w/demo" })).toEqual(
    ok({ path: "/out", files: ["a"], sha256: "a".repeat(64) }),
  );
  expect(await service.link({ source: "/out" })).toEqual(
    ok({ name: "demo", version: "0.1.0", location: "/ext/demo" }),
  );
  expect(calls).toEqual(["scaffold:/w/demo", "validate:/w/demo", "pack:/w/demo", "install:/out"]);
});

test("a missing port is an io error for replay, test runs and the other calls", async () => {
  const service = devkitServiceOf(wiringOf(undefined));
  const notReady: DevkitError = { kind: "io", message: "the devkit is not ready yet" };
  expect(await service.replay({ target: "/w/demo" })).toEqual(err(notReady));
  expect(await service.testRun({ target: "/w/demo" })).toEqual(err(notReady));
  expect(await service.validate("/w/demo")).toEqual(err(notReady));
  expect(await service.kinds()).toEqual([]);
});

test("replay runs ext.test.run of kind replay and returns the report its record holds; testRun returns the thread it opened", async () => {
  const seen: unknown[] = [];
  const report = {
    ok: true,
    commits: 1,
    passed: 1,
    firstDiff: null,
    cuts: [{ commitIndex: 1, equal: true, firstDiff: null }],
    effects: { turn: 1, spawn: 0, delegate: 0, post: 0 },
    failure: null,
  } as const;
  const port = partial<DevkitPort>({
    testRun: (params) => {
      seen.push(params);
      return Promise.resolve(
        ok(
          params.kind === "replay"
            ? { testId: "t-9", threadId: null }
            : { testId: "t-10", threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
        ),
      );
    },
    testList: () =>
      Promise.resolve(
        ok({
          tests: [
            {
              testId: "t-9",
              kind: "replay",
              target: "demo",
              state: "passed",
              startedAt: "2026-11-04T00:00:00.000Z",
              durationMs: 3,
              threadId: null,
              replay: report,
            },
          ],
        }),
      ),
  });
  const service = devkitServiceOf(wiringOf(port));
  expect(await service.replay({ target: "demo", maxCommits: 20 })).toEqual(ok(report));
  expect(await service.replay({ target: "demo" })).toEqual(ok(report));
  expect(await service.testRun({ target: "demo", profileId: "p-1", workspace: "/w" })).toEqual(
    ok({ threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
  );
  expect(seen).toEqual([
    { kind: "replay", target: "demo", options: { maxCommits: 20 } },
    { kind: "replay", target: "demo" },
    { kind: "testRun", target: "demo", options: { profileId: "p-1", workspace: "/w" } },
  ]);
});

test("the port's refusals reach the service unchanged: dev_mode_required for replay, and a test run that opened no thread is io", async () => {
  const port = partial<DevkitPort>({
    testRun: (params) =>
      Promise.resolve(
        params.kind === "replay"
          ? err({ kind: "dev_mode_required", message: "replay runs only in development mode" })
          : ok({ testId: "t-11", threadId: null }),
      ),
  });
  const service = devkitServiceOf(wiringOf(port));
  expect(await service.replay({ target: "demo" })).toEqual(
    err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
  );
  expect(await service.testRun({ target: "demo" })).toEqual(
    err({ kind: "io", message: "the test run did not open a thread" }),
  );
});
