import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseHostArgv } from "../src/argv.ts";
import { exitCodeOf } from "../src/plugin-host/run.ts";
import { parsePluginHostArgv } from "../src/plugin-host/argv.ts";
import { pluginHostLaunch } from "../src/plugin-host/launch.ts";
import { HOST_SDK_MODULES } from "../src/plugin-host/sdk-modules.ts";
import { selfEntryPrefix } from "../src/self-command.ts";

// L4.host-service.spec §3.2, §4.9. `plugin-host --stdio` 인자, 자기 실행 명령의 두 모양(소스와 컴파일 바이너리), 종료코드 매핑.

const SOURCE_SELF = {
  execPath: "/usr/local/bin/bun",
  entry: "/repo/xeon/apps/host/src/main.ts",
};
const COMPILED_SELF = {
  execPath: "/opt/fresnel/fresnel",
  entry: "/$bunfs/root/fresnel",
};

describe("plugin-host argv", () => {
  test("accepts exactly `plugin-host --stdio` and maps it to the plugin-host command", () => {
    expect(parseHostArgv(["plugin-host", "--stdio"])).toEqual({
      ok: true,
      command: { kind: "plugin-host" },
    });
    expect(parsePluginHostArgv(["--stdio"])).toEqual({ ok: true });
  });

  test("rejects every other shape as a usage error", () => {
    const rejected: readonly (readonly string[])[] = [
      [],
      ["plugin-host"],
      ["plugin-host", "--stdin"],
      ["plugin-host", "--stdio", "extra"],
      ["plugin-host", "--stdio", "--stdio"],
      ["plugin-host", "--service"],
    ];
    for (const rest of rejected) {
      const parsed = parseHostArgv(["plugin-host", ...rest]);
      expect(parsed.ok).toBe(false);
    }
    expect(parsePluginHostArgv(["--stdio", "extra"])).toEqual({
      ok: false,
      message: "unknown argument: extra",
    });
    expect(parsePluginHostArgv([])).toEqual({
      ok: false,
      message: "usage: plugin-host --stdio",
    });
  });
});

describe("self-run prefix", () => {
  test("a source run re-runs the entry script under bun", () => {
    expect(selfEntryPrefix(SOURCE_SELF)).toEqual(["/repo/xeon/apps/host/src/main.ts"]);
  });

  test("a compiled binary runs itself, with no script argument", () => {
    expect(selfEntryPrefix(COMPILED_SELF)).toEqual([]);
  });

  test("an entry that is the executable itself adds nothing", () => {
    expect(
      selfEntryPrefix({ execPath: "/opt/fresnel/fresnel", entry: "/opt/fresnel/fresnel" }),
    ).toEqual([]);
  });
});

describe("pluginHostLaunch", () => {
  test("source shape: bun, the entry script, then plugin-host --stdio, with only the extension name in the env", () => {
    expect(
      pluginHostLaunch(
        { name: "demo", root: "/x", entry: "./src/index.ts", versionId: "1.0.0.1" },
        SOURCE_SELF,
      ),
    ).toEqual({
      command: "/usr/local/bin/bun",
      args: ["/repo/xeon/apps/host/src/main.ts", "plugin-host", "--stdio"],
      env: { FRESNEL_EXT_NAME: "demo" },
      // 작업 공간을 못 찾으면(진입 파일 위에 bun.lock이 없다) 진입 파일 폴더만 읽는다
      runtimeReadRoots: ["/repo/xeon/apps/host/src"],
    });
  });

  test("a source run reads the workspace that holds bun.lock, a compiled binary reads nothing more", () => {
    const root = mkdtempSync(join(tmpdir(), "launch-root-"));
    try {
      mkdirSync(join(root, "apps", "host", "src"), { recursive: true });
      writeFileSync(join(root, "bun.lock"), "");
      const launched = pluginHostLaunch(
        { name: "demo", root: "/x", entry: "./src/index.ts", versionId: "1.0.0.1" },
        { execPath: "/usr/local/bin/bun", entry: join(root, "apps", "host", "src", "main.ts") },
      );
      expect(launched.runtimeReadRoots).toEqual([root]);
      expect(
        "runtimeReadRoots" in
          pluginHostLaunch(
            { name: "demo", root: "/x", entry: "./src/index.ts", versionId: "1.0.0.1" },
            COMPILED_SELF,
          ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compiled shape: the binary itself, then plugin-host --stdio, with no script argument", () => {
    expect(
      pluginHostLaunch(
        { name: "demo", root: "/x", entry: "./src/index.ts", versionId: "1.0.0.1" },
        COMPILED_SELF,
      ),
    ).toEqual({
      command: "/opt/fresnel/fresnel",
      args: ["plugin-host", "--stdio"],
      env: { FRESNEL_EXT_NAME: "demo" },
    });
  });
});

describe("plugin-host exit codes", () => {
  test("a normal end is 0, a failed start or a failed loop is 1", () => {
    expect(exitCodeOf("disposed")).toBe(0);
    expect(exitCodeOf("stdin_closed")).toBe(0);
    expect(exitCodeOf("init_failed")).toBe(1);
    expect(exitCodeOf("fault")).toBe(1);
  });

  test("the plugin host gets the group SDK under its published module name", () => {
    expect(Object.keys(HOST_SDK_MODULES)).toEqual(["@fresnel/group-sdk"]);
  });
});
