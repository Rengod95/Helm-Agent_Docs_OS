import { expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { ExtTestRunParamsSchema } from "@fresnel/contracts/wire";
import { SERVICE_NAMES, type DevkitError } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { BUILTIN_CAPABILITY_DEFS } from "../../src/assembly/capability-defs.ts";
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

test("authoring unit: a builtin L3 group that is on by default", () => {
  const unit = authoringUnit(wiringOf(undefined), 7);
  expect(unit.manifest.name).toBe("authoring");
  expect(unit.manifest.defaultEnabled).toBe(true);
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

test("the service forwards to the wire port; link is not wired until the plugin review flow lands", async () => {
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
    submit: async (input) => {
      calls.push(`submit:${input.dir}`);
      return ok({ draftId: "draft_1", itemId: "rvw_1" });
    },
  });
  const service = devkitServiceOf(wiringOf(port));
  expect(await service.scaffold({ kind: "single-plugin", name: "demo", dir: "/w/demo" })).toEqual(
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
  // 제출은 검토 흐름의 제출 포트로 간다(설치는 없다, M5c §7.7). 증거와 목적은 그대로 넘어간다
  expect(
    await service.submit({
      dir: "/w/demo",
      originThreadId: THREAD,
      evidence: [{ kind: "turn", threadId: THREAD, turnId: "t-1" }],
    }),
  ).toEqual(ok({ draftId: "draft_1", itemId: "rvw_1" }));
  expect(calls).toEqual(["scaffold:/w/demo", "validate:/w/demo", "pack:/w/demo", "submit:/w/demo"]);
});

const THREAD: ThreadId = fixedIdFactory(701).next("thr");

test("a missing port is an io error for replay, test runs and the other calls", async () => {
  const service = devkitServiceOf(wiringOf(undefined));
  const notReady: DevkitError = { kind: "io", message: "the devkit is not ready yet" };
  expect(await service.replay({ target: "/w/demo" })).toEqual(err(notReady));
  expect(await service.testRun({ dir: "/w/demo" })).toEqual(err(notReady));
  expect(await service.validate("/w/demo")).toEqual(err(notReady));
  expect(await service.kinds()).toEqual([]);
  expect(
    await service.submit({
      dir: "/w/demo",
      originThreadId: THREAD,
      evidence: [{ kind: "turn", threadId: THREAD, turnId: "t-1" }],
    }),
  ).toEqual(err(notReady));
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
      return Promise.resolve(ok({ testId: "t-9", threadId: null }));
    },
    trialRun: (input) => {
      seen.push({ trial: input });
      return Promise.resolve(ok({ testId: "t-10", threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
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
  expect(await service.testRun({ dir: "/w/demo", profileId: "p-1", workspace: "/w" })).toEqual(
    ok({ threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
  );
  expect(seen).toEqual([
    { kind: "replay", target: "demo", options: { maxCommits: 20 } },
    { kind: "replay", target: "demo" },
    { trial: { dir: "/w/demo", profileId: "p-1", workspace: "/w" } },
  ]);
});

test("the port's refusals reach the service unchanged: dev_mode_required for replay, and a folder test run refusal is returned as it is", async () => {
  const port = partial<DevkitPort>({
    testRun: () =>
      Promise.resolve(
        err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
      ),
    trialRun: () =>
      Promise.resolve(err({ kind: "invalid_input", message: "the plugin folder is not valid" })),
  });
  const service = devkitServiceOf(wiringOf(port));
  expect(await service.replay({ target: "demo" })).toEqual(
    err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
  );
  expect(await service.testRun({ dir: "/w/demo" })).toEqual(
    err({ kind: "invalid_input", message: "the plugin folder is not valid" }),
  );
});

// 드래프트 승인 `auto`(§4.8.1 항목 10 [결정: 2026-11-18 사용자, AGE-56])는 화면(통신을 부르는 쪽)만 고른다. 모델, 플러그인, 빌더는 고르지 못한다.
// (다)의 부정 시험: 제작 서비스의 시험 시작은 승인 방식을 포트에 넘기지 않고, 와이어는 그 칸을 거절하며, 기능 정의 표에는 제작 서비스가 없다.

test("the devkit's test run never carries a draft approval: a draftApproval the caller adds is dropped before the port, so the run is ask", async () => {
  const seen: unknown[] = [];
  const port = partial<DevkitPort>({
    trialRun: (input) => {
      seen.push(input);
      return Promise.resolve(ok({ testId: "t-12", threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    },
  });
  const service = devkitServiceOf(wiringOf(port));
  // 타입은 `draftApproval`을 받지 않는다. 값으로 실어 보내도 포트의 `trialRun`에는 가지 않는다
  const attempt = { dir: "/w/demo", draftApproval: "auto" };
  expect(await service.testRun(attempt)).toEqual(
    ok({ threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
  );
  expect(seen).toEqual([{ dir: "/w/demo" }]);
});

test("the wire test-run params refuse a draftApproval field: only the screen's test-run call can name one, and it does so on testRun.start", () => {
  expect(
    parse(ExtTestRunParamsSchema, { kind: "testRun", target: "demo", draftApproval: "auto" }).ok,
  ).toBe(false);
  expect(parse(ExtTestRunParamsSchema, { kind: "testRun", target: "demo" }).ok).toBe(true);
});

test("no builtin capability definition exposes the devkit service, so a plugin cannot reach testRun or pick a draft approval", () => {
  const ids = BUILTIN_CAPABILITY_DEFS.map((def) => def.id);
  expect(ids).not.toContain(SERVICE_NAMES.devkit);
  expect(ids.some((id) => id.toLowerCase().includes("devkit") || id.includes("testRun"))).toBe(
    false,
  );
});
