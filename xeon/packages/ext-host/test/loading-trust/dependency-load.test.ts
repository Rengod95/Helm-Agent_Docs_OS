import { expect, test } from "bun:test";
import type { DependencyDecl, ExtensionManifest } from "@fresnel/contracts/extensions";
import type { BuiltinExtensionModule } from "../../src/loading-trust/index.ts";
import { createLoaderHarness, moduleOf } from "./support/harness.ts";

// AGE-33: hard 의존은 대상이 없거나 구성원이 없거나 범위가 맞지 않으면 그 확장을 실패시키고, 대상이 먼저 설치되게 한다.
// soft는 맞지 않아도 경고만 남기고, 설치 순서를 바꾸지 않는다. Hook 호출 순서(`loadIndex`)는 로드 순서 그대로다.

/** `dependsOn`을 가진 루트 플러그인 하나짜리 매니페스트 */
function manifestOf(
  name: string,
  dependsOn: readonly DependencyDecl[],
  version = "1.0.0",
): ExtensionManifest {
  return {
    schemaVersion: 2,
    name,
    version,
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: [], dependsOn: [...dependsOn] }],
  };
}

/** 의존을 건 확장 한 개. 설치될 때마다 `installed`에 이름을 남긴다 */
function extensionOf(
  name: string,
  dependsOn: readonly DependencyDecl[],
  installed: string[],
  version?: string,
): BuiltinExtensionModule {
  return moduleOf({ name, manifest: manifestOf(name, dependsOn, version) }, () => {
    installed.push(name);
  });
}

test("a missing hard target fails the dependent with dependency_missing and never installs it", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([extensionOf("app", [{ plugin: "core", kind: "hard" }], installed)]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["app", "error"]]);
  expect(
    report.diagnostics.map((entry) => [entry.extension, entry.code, entry.severity, entry.stage]),
  ).toEqual([["app", "dependency_missing", "error", "capabilities"]]);
  expect(report.diagnostics[0]?.message).toContain("core");
  expect(installed).toEqual([]);
});

test("a missing soft target only warns, and the dependent still loads", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([extensionOf("app", [{ plugin: "core" }], installed)]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["app", "active"]]);
  expect(report.diagnostics.map((entry) => [entry.extension, entry.code, entry.severity])).toEqual([
    ["app", "dependency_missing", "warning"],
  ]);
  expect(installed).toEqual(["app"]);
});

test("a target outside the hard range fails the dependent and names the version it found", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      extensionOf("zz-core", [], installed, "1.0.0"),
      extensionOf("app", [{ plugin: "zz-core", range: "^2.0.0", kind: "hard" }], installed),
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["app", "error"],
    ["zz-core", "active"],
  ]);
  expect(report.diagnostics.map((entry) => [entry.extension, entry.code, entry.severity])).toEqual([
    ["app", "dependency_missing", "error"],
  ]);
  expect(report.diagnostics[0]?.message).toContain("^2.0.0");
  expect(report.diagnostics[0]?.message).toContain("1.0.0");
  expect(installed).toEqual(["zz-core"]);
});

test("a member the target does not have fails the dependent with dependency_missing", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      extensionOf("zz-core", [], installed),
      extensionOf("app", [{ plugin: "zz-core/tools", kind: "hard" }], installed),
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["app", "error"],
    ["zz-core", "active"],
  ]);
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["dependency_missing"]);
  expect(report.diagnostics[0]?.message).toContain("zz-core/tools");
  expect(installed).toEqual(["zz-core"]);
});

test("a hard target installs before its dependent even when the dependent sorts first by name", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      // 같은 층에서 이름순이면 aa-app이 먼저다. 설치는 hard 대상이 먼저여야 한다
      extensionOf("aa-app", [{ plugin: "zz-core", kind: "hard" }], installed),
      extensionOf("zz-core", [], installed),
    ]),
  );
  expect(installed).toEqual(["zz-core", "aa-app"]);
  // 로드 순서(Hook 디스패치의 두 번째 키)는 바뀌지 않는다
  expect(report.extensions.map((info) => [info.name, info.state, info.loadIndex])).toEqual([
    ["aa-app", "active", 0],
    ["zz-core", "active", 1],
  ]);
  expect(report.diagnostics).toEqual([]);
});

test("a soft dependency does not move the install order", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      extensionOf("aa-app", [{ plugin: "zz-core", kind: "soft" }], installed),
      extensionOf("zz-core", [], installed),
    ]),
  );
  expect(installed).toEqual(["aa-app", "zz-core"]);
  expect(report.extensions.map((info) => [info.name, info.loadIndex])).toEqual([
    ["aa-app", 0],
    ["zz-core", 1],
  ]);
});

test("a hard target that fails to activate takes its dependent down with dependency_provider_failed", async () => {
  const harness = await createLoaderHarness();
  const installed: string[] = [];
  const core = moduleOf({ name: "zz-core" }, () => {
    throw new Error("core setup failed");
  });
  const report = await harness.loader.loadAll(
    harness.options([
      extensionOf("aa-app", [{ plugin: "zz-core", kind: "hard" }], installed),
      core,
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["aa-app", "error"],
    ["zz-core", "error"],
  ]);
  expect(report.diagnostics.map((entry) => entry.code)).toEqual([
    "setup_threw",
    "dependency_provider_failed",
  ]);
  expect(installed).toEqual([]);
});
