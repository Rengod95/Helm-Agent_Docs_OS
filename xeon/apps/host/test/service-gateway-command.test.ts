import { describe, expect, test } from "bun:test";
import { childEnvOf, resolveGatewayCommand, uiArgsOf } from "../src/service/gateway-command.ts";

// 웹 게이트웨이 실행 파일 찾기(순수 함수). 파일 존재는 주입된 `exists`로만 본다.

const SERVICE_DIR = "/repo/xeon/apps/host/src/service";
const DEV_MAIN = "/repo/xeon/apps/desktop-shell/src/web/main.ts";

function only(...files: string[]): (file: string) => boolean {
  return (file) => files.includes(file);
}

describe("resolveGatewayCommand", () => {
  test("FRESNEL_WEB_BIN wins when it is an absolute path to an existing file", () => {
    const found = resolveGatewayCommand(
      { FRESNEL_WEB_BIN: "/opt/web/fresnel-web" },
      "/opt/fresnel/bin/fresnel",
      SERVICE_DIR,
      only("/opt/web/fresnel-web", "/opt/fresnel/bin/fresnel-web"),
    );
    expect(found).toEqual({ ok: true, value: { command: ["/opt/web/fresnel-web"] } });
  });

  test("a relative or missing FRESNEL_WEB_BIN is an error and does not fall through to other places", () => {
    const relative = resolveGatewayCommand(
      { FRESNEL_WEB_BIN: "bin/fresnel-web" },
      "/opt/fresnel/bin/fresnel",
      SERVICE_DIR,
      only("/opt/fresnel/bin/fresnel-web"),
    );
    expect(relative.ok).toBe(false);
    const missing = resolveGatewayCommand(
      { FRESNEL_WEB_BIN: "/opt/web/gone" },
      "/opt/fresnel/bin/fresnel",
      SERVICE_DIR,
      only("/opt/fresnel/bin/fresnel-web"),
    );
    expect(missing.ok).toBe(false);
    expect(missing.ok ? null : missing.error.kind).toBe("gateway-binary-missing");
  });

  test("a fresnel-web next to the host binary is used when no override is set", () => {
    const found = resolveGatewayCommand(
      {},
      "/opt/fresnel/bin/fresnel",
      SERVICE_DIR,
      only("/opt/fresnel/bin/fresnel-web"),
    );
    expect(found).toEqual({ ok: true, value: { command: ["/opt/fresnel/bin/fresnel-web"] } });
  });

  test("on a Windows host binary the sibling has the .exe suffix", () => {
    const found = resolveGatewayCommand(
      {},
      "/opt/fresnel/fresnel.exe",
      SERVICE_DIR,
      only("/opt/fresnel/fresnel-web.exe"),
    );
    expect(found).toEqual({ ok: true, value: { command: ["/opt/fresnel/fresnel-web.exe"] } });
  });

  test("with the host running under bun, the development tree runs desktop-shell main.ts through bun run", () => {
    const found = resolveGatewayCommand({}, "/mise/bun/1.4.3/bin/bun", SERVICE_DIR, only(DEV_MAIN));
    expect(found).toEqual({
      ok: true,
      value: { command: ["/mise/bun/1.4.3/bin/bun", "run", DEV_MAIN] },
    });
  });

  test("a compiled host does not use the development tree even when the file exists", () => {
    const found = resolveGatewayCommand(
      {},
      "/opt/fresnel/bin/fresnel",
      SERVICE_DIR,
      only(DEV_MAIN),
    );
    expect(found.ok).toBe(false);
  });

  test("nothing found is gateway-binary-missing with a message that names an environment problem", () => {
    const found = resolveGatewayCommand({}, "/opt/fresnel/bin/fresnel", SERVICE_DIR, () => false);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.kind).toBe("gateway-binary-missing");
    expect(found.error.message).toContain("environment problem");
    expect(found.error.message).toContain("FRESNEL_WEB_BIN");
  });
});

describe("gateway child arguments and environment", () => {
  test("the UI folder is passed only when FRESNEL_WEB_UI is set", () => {
    expect(uiArgsOf({ FRESNEL_WEB_UI: "/opt/web/ui" })).toEqual(["--ui", "/opt/web/ui"]);
    expect(uiArgsOf({})).toEqual([]);
    expect(uiArgsOf({ FRESNEL_WEB_UI: "" })).toEqual([]);
  });

  test("the child environment keeps only the allow-listed names, HOME, and non-secret FRESNEL values", () => {
    const env = childEnvOf(
      {
        PATH: "/usr/bin",
        LANG: "ko_KR.UTF-8",
        AWS_SECRET_ACCESS_KEY: "leak-me",
        FRESNEL_REMOTE_TOKEN: "leak-me-too",
        FRESNEL_WEB_UI: "/opt/web/ui",
        HOME: "/ignored/home",
        UNRELATED: "x",
      },
      "/home/user",
    );
    expect(env).toEqual({
      HOME: "/home/user",
      PATH: "/usr/bin",
      LANG: "ko_KR.UTF-8",
      FRESNEL_WEB_UI: "/opt/web/ui",
    });
  });
});
