import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// cross/C-02, X.loading-trust §4.8(b): 외부 확장이 코어(내장) 기능을 requires하면 로더가 코어 기능 레지스트리로 채운다.
// 조립이 coreCapabilities를 넘기지 않으면 capability_missing으로 거절됐다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

function install(root: string, name: string, requires: readonly { id: string; range: string }[]) {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], requires }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {\n  register(${JSON.stringify(name)}, {}, () => {});\n};\n`,
  );
}

async function statusesOf(requires: readonly { id: string; range: string }[]) {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  install(join(home.root, "config", "extensions", "demo-user"), "demo-user", requires);
  const host = await startInProcessHost({
    pluginHost: { disabled: true },
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-core-cap-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("ext-core-cap", "done."),
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    // 매니페스트의 기본으로 켜짐은 번들에만 효력이 있다(AGE-49): 프로필에 넣고 그 프로필의 대화를 열어야 적재와 기능 검사가 돈다
    await connection.request("profile.put", {
      profile: {
        id: "default",
        title: "default",
        plugins: [
          { name: "cap-workspace" },
          { name: "cap-dialog" },
          { name: "cap-knowledge" },
          { name: "demo-user" },
        ],
        settings: [],
        startDrive: null,
      },
      baseRev: null,
    });
    const opened = await connection.request("thread.create", {
      workspace: realpathSync(mkdtempSync(join(tmpdir(), "ext-core-cap-ws-"))),
    });
    const listed = await connection.request("ext.list", { threadId: opened.threadId });
    const entry = listed.extensions.find((item) => item.name === "demo-user");
    return {
      status: entry?.status,
      codes: (entry?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    };
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
  }
}

realTest(
  "an external extension that requires a built-in capability loads",
  async () => {
    const result = await statusesOf([{ id: "knowledge.memory", range: "^1.0.0" }]);
    expect(result.codes).toEqual([]);
    expect(result.status).toBe("enabled");
  },
  60_000,
);

realTest(
  "an external extension that requires an unknown capability is still refused",
  async () => {
    const result = await statusesOf([{ id: "demo.nothing", range: "^1.0.0" }]);
    expect(result.codes).toContain("capability_missing");
  },
  60_000,
);
