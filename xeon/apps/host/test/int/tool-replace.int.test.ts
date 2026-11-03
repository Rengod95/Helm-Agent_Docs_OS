import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf, type BuiltinExtensionModule } from "@fresnel/ext-host";
import { Type } from "typebox";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// F.capabilities.spec §10 [결정: 2026-11-03 사용자], L1.tools.spec §4.13. 실제 엔진(조립, 로더, ExtHost, core-tools, wire)에서
// 매니페스트 `replaces`를 선언한 사용자 플러그인이 `read`를 대체하려 하면 활성화 승인이 wire로 나오고, 선언이 없으면 승인이 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "acme-files";

const extension: ExtensionEntry = ({ manifest: loaded, register }) => {
  register(loaded.name, {}, (g) => {
    hostOf(g).registerTool({
      name: "read",
      description: "read files my way",
      parameters: Type.Object({ path: Type.String() }),
      replay: "safe",
      execute: () => Promise.resolve("from the plugin"),
    });
  });
};

/** 조립 루트가 싣는 확장 모듈 하나. `replaces`는 매니페스트 선언이고 도구 `read`는 항상 등록한다 */
function pluginModule(replaces: readonly string[]): BuiltinExtensionModule {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: NAME,
    version: "1.0.0",
    entry: "./src/index.ts",
    plugins: [
      { layer: "plugin", hooks: [], ...(replaces.length === 0 ? {} : { replaces: [...replaces] }) },
    ],
  });
  return { manifest, extension };
}

async function start(replaces: readonly string[]) {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "tool-replace-bundles-")),
    extraPlugins: [pluginModule(replaces)],
    buildModels: answeringModels("tool-replace", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const created = await connection.request("thread.create", {});
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const close = async (): Promise<void> => {
    await connection.close();
    await host.close();
    home.dispose();
  };
  return { connection, collector, threadId: created.threadId, close };
}

realTest(
  "a declared replacement raises a tool_replace approval over the wire and an allow answer resolves it",
  async () => {
    const fx = await start(["read"]);
    try {
      await fx.connection.request("turn.start", { threadId: fx.threadId, input: "질문" });
      const asked = await fx.collector.waitFor((event) => event.kind === "approval.requested");
      const listed = await fx.connection.request("approval.list", { threadId: fx.threadId });
      expect(listed.approvals).toHaveLength(1);
      const [pending] = listed.approvals;
      expect(pending?.request.title).toBe(`Let "${NAME}" replace the built-in tool "read"?`);
      expect(pending?.request.body).toMatchObject({
        kind: "tool",
        tool: {
          toolName: "tool_replace",
          ruleId: "tools.replace",
          args: { tool: "read", extension: NAME, trust: "builtin" },
        },
      });
      expect(JSON.stringify(pending?.request.body)).toContain("enforce path protection itself");
      const answered = await fx.connection.request("approval.respond", {
        approvalId: asked.id,
        decision: "allow",
      });
      expect(answered).toEqual({ applied: true });
      const after = await fx.connection.request("approval.list", { threadId: fx.threadId });
      expect(after.approvals).toEqual([]);
    } finally {
      await fx.close();
    }
  },
  60_000,
);

realTest(
  "the same plugin without the manifest declaration is refused and the engine does not start with it",
  async () => {
    // 선언 없는 같은 이름은 대체가 아니다. 등록이 name_conflict로 거부되어 확장의 setup이 실패하고 조립이 알린다
    const caught = await rejectionOf(start([]));
    expect(caught instanceof Error ? caught.message : "").toContain(
      "tool read is already registered in fresnel.tools",
    );
  },
  60_000,
);
