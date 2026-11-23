// 저장소 예제 확장 `examples/kanban`이 화면 검사(5b단계)를 통과하는지 본다. 앱 화면 하나(board, mode app, 대체 화면 있음).
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkUiDecl,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
} from "../../src/loading-trust/index.ts";
import { realLoaderFs } from "./support/real-fs.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "examples", "kanban");

test("the kanban example passes the ui check with one app page that has a fallback", async () => {
  const text = await realLoaderFs.readText(join(ROOT, ".fresnel-plugin", "plugin.json"));
  if (text === null) throw new Error("examples/kanban manifest is missing");
  const manifest: { readonly ui: Parameters<typeof checkUiDecl>[0]["ui"] } = JSON.parse(text);
  const reports = await checkUiDecl({
    ui: manifest.ui,
    root: ROOT,
    fs: realLoaderFs,
    source: "user",
    owner: { name: "kanban", readsRecordKinds: [] },
    policy: { apps: true, allowProjectApps: false },
    hostWidgetsVersion: HOST_WIDGETS_VERSION,
    hostBridgeVersion: HOST_BRIDGE_VERSION,
  });
  expect(reports.map((report) => [report.id, report.state, report.issues])).toEqual([
    ["board", "ok", []],
  ]);
});
