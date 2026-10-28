import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@xeon/contracts";
import { validateManifest } from "@xeon/contracts/extensions";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import { helmManifest } from "../../src/index.ts";
import { buildHelmPlugin, type PluginBuild } from "../../scripts/build-plugin.ts";
import { loaderFor, SDK_MODULES } from "../support/loader.ts";
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
  const text = await Bun.file(join(built.outDir, ".xeon-plugin", "plugin.json")).text();
  const parsed = parseJson(text);
  const expected = parseJson(JSON.stringify(helmManifest));
  expect(parsed.ok && expected.ok).toBe(true);
  const checked = validateManifest(parsed.ok ? parsed.value : undefined);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(parseJson(JSON.stringify(checked.manifest))).toEqual(expected);
  expect(checked.manifest?.entry).toBe("./dist/index.js");
  expect(checked.manifest?.trust).toEqual({ level: "user" });
  // 번들이 가져오는 패키지는 호스트가 가상 모듈로 등록하는 것뿐이다
  expect(built.externals.every((specifier) => specifier in SDK_MODULES)).toBe(true);
  expect(built.externals).toContain("@xeon/group-kit");
  expect(built.externals).toContain("typebox");
  const bundle = await Bun.file(join(built.outDir, "dist", "index.js")).text();
  expect(bundle).not.toContain("@xeon/ext-host");
  expect(await Bun.file(join(built.outDir, "agents", "explorer.md")).exists()).toBe(true);
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
  expect(t.host.scope("helm")).toBeUndefined();
  expect(t.host.resources.list("command")).toEqual([]);
});
