// 웹 탭의 키 등록(`secret_register`)이 데스크톱과 같은 길로 사이드카에 닿는지 본다. 게이트웨이는 빌드된 실행 파일로 가정하고
// (`/$bunfs/root`에서 돈다), 사이드카는 패키지 앱처럼 게이트웨이 옆 폴더에 둔다. 사이드카 대역은 값을 stdin으로 받아 버리고 0으로 끝난다.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resourcesDirOf } from "../../../src/web/main/resources.ts";
import { createWebContext } from "../../../src/web/session/web-context.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordedLog, sessionOptions } from "./support.ts";

afterEach(cleanupTempDirs);

const FAKE_VALUE = "fake-key-for-web-session-0003";
const ENCODER = new TextEncoder();
/** 시험 탭의 플랫폼은 `sessionOptions`의 기본(darwin, arm64)이다. 사이드카 이름도 그 목표 삼중항을 쓴다 */
const SIDECAR_NAME = "fresnel-aarch64-apple-darwin";
/** `bun build --compile`로 만든 게이트웨이가 코드를 두는 가상 폴더(`src/web/main.ts`의 `HERE`) */
const COMPILED_HERE = "/$bunfs/root";

/** 패키지 앱의 Resources처럼 게이트웨이 옆에 가짜 사이드카를 둔다. 값을 읽어 버리고 0으로 끝난다. 사이드카를 찾는 폴더를 돌려준다 */
function packagedResources(): string {
  const folder = tempDir();
  const gatewayFile = path.join(folder, "fresnel-web");
  writeFileSync(gatewayFile, "");
  const sidecar = path.join(folder, SIDECAR_NAME);
  writeFileSync(sidecar, "#!/bin/sh\ncat > /dev/null\nexit 0\n");
  chmodSync(sidecar, 0o755);
  return resourcesDirOf(COMPILED_HERE, gatewayFile);
}

/** `<동작> <이름>\n<값>` 본문 */
function bodyOf(head: string, value: string): Uint8Array {
  return ENCODER.encode(`${head}\n${value}`);
}

describe("a web tab in a built gateway", () => {
  test("registers a key through the sidecar beside the gateway, wipes the body, and never logs the value", async () => {
    const resources = packagedResources();
    const log = recordedLog();
    const web = createWebContext({
      ...sessionOptions(path.join(tempDir(), "absent.sock"), log),
      resources,
      deviceId: "dev_test",
      tabId: "tab_test",
      send: () => undefined,
    });
    const body = bodyOf("add tape-api-key", FAKE_VALUE);
    try {
      expect(await web.dispatch("secret_register", { body, headers: {} })).toEqual({
        ok: true,
        value: null,
      });
    } finally {
      await web.close();
    }
    // 보낸 뒤 본문 버퍼는 0으로 덮인다(데스크톱과 같다)
    expect(body.every((byte) => byte === 0)).toBe(true);
    // 로그 줄에는 이름과 결과 종류만 남고 값은 없다
    expect(log.lines).toContain("secret entry add tape-api-key: ok");
    expect(log.lines.join("\n")).not.toContain(FAKE_VALUE);
  });
});
