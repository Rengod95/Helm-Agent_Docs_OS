// 저장소 예제 확장 `examples/kanban-native`가 화면 검사(5b단계)를 통과하는지 본다. native 화면 셋(보드 페이지, 순서 목록 페이지, 보드 패널).
// 소유자 정보의 메서드는 매니페스트에서 읽어 로더와 같은 모양으로 넘긴다.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { validateManifest } from "@fresnel/contracts/extensions";
import {
  checkUiDecl,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
} from "../../src/loading-trust/index.ts";
import { realLoaderFs } from "./support/real-fs.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "examples", "kanban-native");

test("the native kanban example passes the ui check: every view is ok and carries its tree", async () => {
  const text = await realLoaderFs.readText(join(ROOT, ".fresnel-plugin", "plugin.json"));
  if (text === null) throw new Error("examples/kanban-native manifest is missing");
  const { manifest } = validateManifest(JSON.parse(text));
  if (manifest?.ui === undefined) throw new Error("examples/kanban-native has no ui");
  const reports = await checkUiDecl({
    ui: manifest.ui,
    root: ROOT,
    fs: realLoaderFs,
    source: "user",
    owner: {
      name: "kanban-native",
      readsRecordKinds: [],
      methods: (manifest.methods ?? []).map((method) => ({
        verb: method.verb,
        readOnly: method.readOnly,
      })),
    },
    policy: { apps: true, allowProjectApps: false },
    hostWidgetsVersion: HOST_WIDGETS_VERSION,
    hostBridgeVersion: HOST_BRIDGE_VERSION,
  });
  expect(reports.map((report) => [report.id, report.state, report.mode, report.issues])).toEqual([
    ["board", "ok", "native", []],
    ["order", "ok", "native", []],
    ["side", "ok", "native", []],
  ]);
  expect(reports.map((report) => report.tree?.type)).toEqual(["Board", "SortableList", "Board"]);
});

test("the same views without the manifest methods are invalid, so the check really reads the method names", async () => {
  const text = await realLoaderFs.readText(join(ROOT, ".fresnel-plugin", "plugin.json"));
  if (text === null) throw new Error("examples/kanban-native manifest is missing");
  const { manifest } = validateManifest(JSON.parse(text));
  if (manifest?.ui === undefined) throw new Error("examples/kanban-native has no ui");
  const reports = await checkUiDecl({
    ui: manifest.ui,
    root: ROOT,
    fs: realLoaderFs,
    source: "user",
    owner: { name: "kanban-native", readsRecordKinds: [] },
    policy: { apps: true, allowProjectApps: false },
    hostWidgetsVersion: HOST_WIDGETS_VERSION,
    hostBridgeVersion: HOST_BRIDGE_VERSION,
  });
  expect(reports.map((report) => [report.id, report.state, report.issues.length])).toEqual([
    ["board", "invalid", 2],
    ["order", "invalid", 1],
    ["side", "invalid", 2],
  ]);
});
