import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DevkitPort } from "../../src/handlers/m4/devkit.ts";
import {
  authoringLoaded,
  authoringUnit,
  devkitServiceOf,
  type AuthoringWiring,
} from "../../src/assembly/authoring.ts";
import { partial } from "../fixtures/unsafe.ts";

// 제작 그룹의 내장 등록(`assembly/authoring.ts`). 기본 꺼짐, 안전 모드와 기본 그룹 끄기에서는 싣지 않음, wire 포트를 서비스 계약으로 맞춤.

function wiringOf(port: DevkitPort | undefined): AuthoringWiring {
  return { devkit: () => port };
}

test("authoring unit: a builtin L3 group that stays off by default", () => {
  const unit = authoringUnit(wiringOf(undefined), 7);
  expect(unit.manifest.name).toBe("authoring");
  expect(unit.manifest.defaultEnabled).toBe(false);
  expect(unit.manifest.trust).toEqual({ level: "builtin" });
  expect(unit.builtin).toBe(true);
  expect(unit.loadIndex).toBe(7);
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

test("replay is refused as dev_mode_required, test runs are not available, and a missing port is an io error", async () => {
  const service = devkitServiceOf(wiringOf(undefined));
  expect(await service.replay({ target: "/w/demo" })).toEqual(
    err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
  );
  expect(await service.testRun({ target: "/w/demo" })).toEqual(
    err({ kind: "io", message: "Test runs are not available from the authoring group yet" }),
  );
  expect(await service.validate("/w/demo")).toEqual(
    err({ kind: "io", message: "the devkit is not ready yet" }),
  );
  expect(await service.kinds()).toEqual([]);
});
