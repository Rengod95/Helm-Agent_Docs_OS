// 저장소 예제 확장 `examples/viewdemo`가 5b단계 검사를 통과하는지 본다(app 프레임 화면과 native 화면 각 하나).
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkUiDecl,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
} from "../../src/loading-trust/index.ts";
import { realLoaderFs } from "./support/real-fs.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "examples", "viewdemo");

test("the viewdemo example passes the ui check with one app frame and one native page", async () => {
  const text = await realLoaderFs.readText(join(ROOT, ".fresnel-plugin", "plugin.json"));
  if (text === null) throw new Error("examples/viewdemo manifest is missing");
  const manifest: { readonly ui: Parameters<typeof checkUiDecl>[0]["ui"] } = JSON.parse(text);
  const reports = await checkUiDecl({
    ui: manifest.ui,
    root: ROOT,
    fs: realLoaderFs,
    source: "user",
    owner: { name: "viewdemo", readsRecordKinds: [] },
    policy: { apps: true, allowProjectApps: false },
    hostWidgetsVersion: HOST_WIDGETS_VERSION,
    hostBridgeVersion: HOST_BRIDGE_VERSION,
  });
  expect(reports.map((report) => [report.id, report.state, report.issues])).toEqual([
    ["frame", "ok", []],
    ["notes", "ok", []],
  ]);
});
