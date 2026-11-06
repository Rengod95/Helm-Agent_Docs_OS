import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import { validateManifest } from "@fresnel/contracts/extensions";
import { SDK_MODULE_SPECIFIERS } from "@fresnel/ext-host";
import { createTestHost, fixedIdFactory } from "@fresnel/ext-host/testing";
import { helmComposition, helmManifest, helmUi } from "../../src/index.ts";
import { buildHelmPlugin, type PluginBuild } from "../../scripts/build-plugin.ts";
import { loaderFor } from "../support/loader.ts";
import {
  DEFS,
  callCommand,
  createWorld,
  defaultAnswers,
  drainRounds,
  installWorld,
  scriptedLoop,
  settleOnce,
} from "../support/rig.ts";

let root: string;
let built: PluginBuild;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "helm-plugin-"));
  await mkdir(join(root, "project"));
  const result = await buildHelmPlugin(join(root, "out"));
  if (!result.ok) throw new Error(`plugin build failed: ${result.error.kind}`);
  built = result.value;
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("plugin.json is the manifest as JSON and the bundle keeps the host SDK modules external", async () => {
  const text = await Bun.file(join(built.outDir, ".fresnel-plugin", "plugin.json")).text();
  const parsed = parseJson(text);
  const expected = parseJson(JSON.stringify(helmManifest));
  expect(parsed.ok && expected.ok).toBe(true);
  const checked = validateManifest(parsed.ok ? parsed.value : undefined);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(parseJson(JSON.stringify(checked.manifest))).toEqual(expected);
  expect(checked.manifest?.entry).toBe("./dist/index.js");
  expect(checked.manifest?.trust).toEqual({ level: "user" });
  // 번들이 가져오는 패키지는 호스트가 가상 모듈로 등록하는 것뿐이다
  expect(built.externals.filter((specifier) => !SDK_MODULE_SPECIFIERS.includes(specifier))).toEqual(
    [],
  );
  expect(built.externals).toContain("@fresnel/group-sdk");
  expect(built.externals).toContain("typebox");
  const bundle = await Bun.file(join(built.outDir, "dist", "index.js")).text();
  expect(bundle).not.toContain("@fresnel/ext-host");
  expect(await Bun.file(join(built.outDir, "agents", "explorer.md")).exists()).toBe(true);
  // 확장 메서드와 Plugin UI 화면, 구성 선언은 plugin.json에 실리고 화면 파일은 ui/ 아래에 있다
  expect(checked.manifest?.methods?.map((decl) => decl.verb)).toEqual([
    "status",
    "inquiries",
    "findings",
  ]);
  expect(checked.manifest?.ui).toEqual(helmUi);
  expect(checked.manifest?.group?.composition).toEqual(helmComposition);
  const screens = helmUi.items.flatMap((item) =>
    item.file === undefined ? [] : [join(built.outDir, item.file)],
  );
  expect(await Promise.all(screens.map((file) => Bun.file(file).exists()))).toEqual(
    screens.map(() => true),
  );
});

test("the external loader loads Helm from the user extension dir at user trust and an inquiry runs", async () => {
  const world = createWorld();
  const t = await createTestHost({
    capabilityDefs: DEFS,
    loop: scriptedLoop(fixedIdFactory(9000), defaultAnswers()),
  });
  await installWorld(t, world);
  const rig = await loaderFor(t, join(root, "run1"), built.outDir);
  const report = await rig.loader.loadAll({
    builtins: [],
    cwd: join(root, "project"),
    mode: "headless",
    signal: new AbortController().signal,
  });
  expect(report.diagnostics).toEqual([]);
  expect(report.extensions.map((info) => [info.name, info.source, info.trust, info.state])).toEqual(
    [["helm", "user", "user", "active"]],
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.resources.list("command").map((entry) => entry.name)).toContain("helm");
  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "start");
  await drainRounds(t, thread, 8);
  expect(t.loop.turns).toHaveLength(2);
  expect(t.loop.spawns).toHaveLength(3);
  // 승인 카드의 출처 이름: 렌즈마다 "렌즈 <제목>"이 SpawnSpec.label로 간다
  for (const spawned of t.loop.spawns) {
    expect(spawned.spec.label).toMatch(/^렌즈 \S/);
  }
  expect(world.fakes.tasks.created).toHaveLength(2);
  const finished = t.records
    .events(thread)
    .filter((event) => event.kind === "grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  await rig.loader.dispose();
});

test("safe mode does not load Helm", async () => {
  const t = await createTestHost({ capabilityDefs: DEFS });
  const rig = await loaderFor(t, join(root, "run2"), built.outDir);
  const report = await rig.loader.loadAll({
    builtins: [],
    cwd: join(root, "project"),
    mode: "headless",
    signal: new AbortController().signal,
    startup: { safeMode: { active: true, source: "flag" }, disabled: [] },
  });
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([["helm", "disabled"]]);
  expect(t.host.registration("helm")).toBeUndefined();
  expect(t.host.resources.list("command")).toEqual([]);
});
