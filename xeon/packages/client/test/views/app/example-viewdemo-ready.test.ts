import { expect, test } from "bun:test";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "@fresnel/contracts";
import { BridgeReadySchema } from "@fresnel/contracts/extensions";
import { buildAppUrl } from "../../../src/views/app/index.ts";

// 예제 확장 `examples/viewdemo`의 프레임 스크립트를 가짜 창에서 돌려, 부모에게 보내는 준비 신호(ready)가 호스트(`frame-host.ts`)가
// 받아들이는 모양인지 본다: 계약 스키마를 통과하고, 매니페스트의 bridge 범위와 같고, 주소 조각 `#n=<nonce>`의 nonce를 되돌린다.
// 예전 예제는 nonce를 빼서 앱에서 항상 `bridge_format`으로 닫혔다(F-S2-1).

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..", "examples", "viewdemo");

async function readyOf(url: string): Promise<unknown[]> {
  const source = await Bun.file(join(ROOT, "ui", "app", "app.js")).text();
  const posted: unknown[] = [];
  const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  const fakeDocument = { getElementById: () => ({ textContent: "" }) };
  const fakeWindow = {
    addEventListener: () => undefined,
    parent: { postMessage: (message: unknown) => posted.push(message) },
  };
  // 예제 스크립트를 격리된 전역에서 돌린다(document, window, location만 있다)
  runInNewContext(source, {
    document: fakeDocument,
    window: fakeWindow,
    location: { hash },
    URLSearchParams,
  });
  return posted;
}

test("the viewdemo frame answers the shell's nonce in its ready signal", async () => {
  const nonce = "abcDEF123_-xyz90";
  const url = buildAppUrl("viewdemo", "0.1.0", "app/index.html", nonce);
  if (url === undefined) throw new Error("buildAppUrl refused the demo path");
  const posted = await readyOf(url);
  expect(posted).toHaveLength(1);
  const ready = parse(BridgeReadySchema, posted[0]);
  expect(ready.ok).toBe(true);
  expect(posted[0]).toEqual({ v: 1, ready: true, bridge: "^1.0.0", nonce });
});

test("the demo's declared bridge range equals the one it sends", async () => {
  const manifest: {
    readonly ui: { readonly items: readonly { readonly app?: { readonly bridge: string } }[] };
  } = JSON.parse(await Bun.file(join(ROOT, ".fresnel-plugin", "plugin.json")).text());
  const declared = manifest.ui.items.find((item) => item.app !== undefined)?.app?.bridge;
  const posted = await readyOf("fresnel-view://viewdemo/1.0.0/app/index.html#n=abcDEF123_-xyz90");
  const sent = parse(BridgeReadySchema, posted[0]);
  expect(declared).toBe("^1.0.0");
  expect(sent.ok ? sent.value.bridge : null).toBe(declared ?? null);
});
