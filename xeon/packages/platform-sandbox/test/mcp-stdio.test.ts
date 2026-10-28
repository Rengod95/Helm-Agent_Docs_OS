import { describe, expect, test } from "bun:test";
import { decideMcpStdioSandbox, shellForMcpStdio } from "../src/mcp-stdio.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  recordingShell,
  settingsOf,
  NO_CANCEL,
} from "./support/fakes.ts";
import { createSandboxService } from "../src/service.ts";

describe("MCP stdio sandbox decision", () => {
  test.each([
    ["settings:project", undefined, true, "origin_default"],
    ["mcpjson:project", undefined, true, "origin_default"],
    ["mcpjson:xeon", undefined, true, "origin_default"],
    ["ext:some-ext", undefined, true, "origin_default"],
    ["something:new", undefined, true, "origin_default"],
    ["settings:user", undefined, false, "origin_default"],
    ["settings:user", true, true, "server_setting"],
    ["settings:project", false, false, "server_setting"],
  ] as const)("%s with server setting %s", (source, setting, sandboxed, decidedBy) => {
    expect(decideMcpStdioSandbox(source, setting)).toEqual({ sandboxed, decidedBy });
  });

  test("the chosen shell is wrapped only when the decision says so", async () => {
    const dirs = makeTestDirs();
    const srt = fakeSrt({ passthrough: true });
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt,
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const policy = service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    const inner = recordingShell();

    const wrapped = shellForMcpStdio(
      service,
      inner,
      policy,
      decideMcpStdioSandbox("mcpjson:project", undefined),
    );
    const projectRun = await wrapped.exec(
      ["server", "--stdio"],
      { cwd: dirs.workspace },
      NO_CANCEL,
    );
    expect(projectRun.ok && projectRun.value.sandbox?.sandboxed).toBe(true);
    expect(srt.wrapCalls.map((call) => call.command)).toEqual(["server --stdio"]);

    const plain = shellForMcpStdio(
      service,
      inner,
      policy,
      decideMcpStdioSandbox("settings:user", undefined),
    );
    const userRun = await plain.exec(["server", "--stdio"], { cwd: dirs.workspace }, NO_CANCEL);
    expect(userRun.ok && userRun.value.sandbox).toBeUndefined();
    expect(srt.wrapCalls.length).toBe(1);
  });
});
