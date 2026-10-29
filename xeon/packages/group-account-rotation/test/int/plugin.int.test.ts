import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@xeon/contracts";
import { validateManifest } from "@xeon/contracts/extensions";
import { SDK_MODULE_SPECIFIERS } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { accountRotationManifest } from "../../src/index.ts";
import { buildAccountRotationPlugin, type PluginBuild } from "../../scripts/build-plugin.ts";
import { loaderFor } from "../support/loader.ts";

let root: string;
let built: PluginBuild;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "account-rotation-plugin-"));
  await mkdir(join(root, "project"));
  const result = await buildAccountRotationPlugin(join(root, "out"));
  if (!result.ok) throw new Error(`plugin build failed: ${result.error.kind}`);
  built = result.value;
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("plugin.json is the manifest as JSON and the bundle keeps the host SDK modules external", async () => {
  const text = await Bun.file(join(built.outDir, ".xeon-plugin", "plugin.json")).text();
  const parsed = parseJson(text);
  const expected = parseJson(JSON.stringify(accountRotationManifest));
  expect(parsed.ok && expected.ok).toBe(true);
  const checked = validateManifest(parsed.ok ? parsed.value : undefined);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(parseJson(JSON.stringify(checked.manifest))).toEqual(expected);
  expect(checked.manifest?.entry).toBe("./dist/index.js");
  expect(checked.manifest?.defaultEnabled).toBe(false);
  // 번들이 가져오는 패키지는 호스트가 가상 모듈로 등록하는 것뿐이다
  expect(built.externals.filter((specifier) => !SDK_MODULE_SPECIFIERS.includes(specifier))).toEqual(
    [],
  );
  expect(built.externals).toContain("@xeon/group-kit");
  const bundle = await Bun.file(join(built.outDir, "dist", "index.js")).text();
  expect(bundle).not.toContain("@xeon/ext-host");
});

// core-models의 게이트가 읽는 것과 같은 조회다(ext.scopes()에서 id가 정확히 account-rotation인 항목의 status)
const statusOf = (host: {
  scopes(): readonly { id: string; status: string }[];
}): string | undefined => host.scopes().find((info) => info.id === "account-rotation")?.status;

test("by default the loader leaves the plugin out, so no account-rotation scope is enabled", async () => {
  const t = await createTestHost();
  const rig = await loaderFor(t, join(root, "run1"), built.outDir, { userEnabled: false });
  const report = await rig.loader.loadAll({
    builtins: [],
    cwd: join(root, "project"),
    mode: "headless",
    signal: new AbortController().signal,
  });
  expect(report.diagnostics.map((item) => item.code)).toEqual(["disabled_by_setting"]);
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["account-rotation", "disabled"],
  ]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(statusOf(t.host)).toBeUndefined();
  await rig.loader.dispose();
});

test("with the user switch on, scope account-rotation is enabled and follows the scope toggle", async () => {
  const t = await createTestHost();
  const rig = await loaderFor(t, join(root, "run2"), built.outDir, { userEnabled: true });
  const report = await rig.loader.loadAll({
    builtins: [],
    cwd: join(root, "project"),
    mode: "headless",
    signal: new AbortController().signal,
  });
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.trust, info.state])).toEqual([
    ["account-rotation", "user", "active"],
  ]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(statusOf(t.host)).toBe("enabled");
  t.host.scope("account-rotation")?.disable();
  await t.settled();
  expect(statusOf(t.host)).toBe("disabled");
  t.host.scope("account-rotation")?.enable();
  await t.settled();
  expect(statusOf(t.host)).toBe("enabled");
  await rig.loader.dispose();
});
