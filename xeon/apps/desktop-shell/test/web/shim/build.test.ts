import { describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { buildShimSource } from "../../../src/web/shim/build.ts";
import type { ShimApi } from "../../../src/web/shim/shim.ts";
import { isRecord } from "../../../src/web/shim/util.ts";
import { fakeLocation } from "./support.ts";

/** 브라우저 WebSocket의 자리만 채운다. 사건을 내지 않으므로 열리지도 닫히지도 않는다 */
class SilentWebSocket {
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {
    return;
  }

  send(): void {
    return;
  }

  close(): void {
    return;
  }
}

function isShellApi(value: unknown): value is ShimApi {
  return (
    isRecord(value) &&
    typeof value.invoke === "function" &&
    typeof value.openChannel === "function" &&
    typeof value.closeChannel === "function" &&
    typeof value.listen === "function"
  );
}

describe("shim bundle", () => {
  test("buildShimSource bundles the browser entry once, without node modules", async () => {
    const source = await buildShimSource();
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("fresnelShell");
    expect(source.includes("node:")).toBe(false);
    expect(buildShimSource()).toBe(buildShimSource());
  });

  test("running the bundle installs window.fresnelShell with the four methods", async () => {
    const source = await buildShimSource();
    const context: Record<string, unknown> = {
      location: fakeLocation("127.0.0.1:9"),
      WebSocket: SilentWebSocket,
      document: {},
      navigator: {},
      isSecureContext: false,
      setTimeout: () => 0,
      fetch: () => Promise.reject(new Error("no network in this test")),
    };
    context.window = context;
    createContext(context);
    runInContext(source, context);
    const shell = context.fresnelShell;
    if (!isShellApi(shell)) throw new Error("window.fresnelShell was not installed");
    expect(await shell.invoke("shell_capabilities")).toEqual({
      kind: "web",
      folderPicker: "origin",
      fileDownload: true,
      push: false,
    });
  });
});
