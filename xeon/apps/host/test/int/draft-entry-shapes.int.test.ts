import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { locateTemplateDirs, scaffoldExtension } from "@fresnel/core-authoring";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// F-10, F-47 (int, 실제 엔진과 실제 격리): 빌더 뼈대와 모델이 쓰는 그룹 입구(`export default defineOrchestration`,
// `orchestrationManifest(plugin.json)`)가 초안(Test run은 내부 이름으로 싣는다)으로 로드된다. 예전에는 파일의 이름으로 등록해
// 입구가 던져 `draft_unavailable`로 실패했다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const templates = locateTemplateDirs({});

/** 그룹 입구(모델이 손으로 쓰는 모양): 기본 내보내기, 매니페스트 파일 가져오기, 도구 하나 */
const GROUP_ENTRY = `import { Type } from "typebox";
import { defineOrchestration, orchestrationManifest } from "@fresnel/orchestration-sdk";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };

const group = defineOrchestration({
  manifest: orchestrationManifest(manifestJson),
  setup(g) {
    g.registerTool({
      name: "greeter_hello",
      description: "Say hello",
      parameters: Type.Object({}),
      replay: "safe",
      execute: () => Promise.resolve("hello"),
    });
  },
});

export default group;
`;

interface Shape {
  readonly name: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, string>>;
  /** 폴더를 만든다 */
  readonly make: (folder: string) => Promise<void>;
}

const SHAPES: readonly Shape[] = [
  {
    name: "greeter",
    tool: "greeter_hello",
    args: {},
    make: (folder) => {
      mkdirSync(join(folder, ".fresnel-plugin"), { recursive: true });
      mkdirSync(join(folder, "src"), { recursive: true });
      writeFileSync(
        join(folder, ".fresnel-plugin", "plugin.json"),
        JSON.stringify({
          schemaVersion: 2,
          name: "greeter",
          version: "1.0.0",
          purpose: "Say hello",
          description: "Greets the user",
          defaultEnabled: false,
          entry: "./src/index.ts",
          orchestration: {},
          plugins: [{ layer: "L3", hooks: [], requires: [], optional: [] }],
        }),
      );
      writeFileSync(join(folder, "src", "index.ts"), GROUP_ENTRY);
      return Promise.resolve();
    },
  },
  {
    name: "appdemo",
    tool: "appdemo_add_item",
    args: { title: "milk" },
    make: async (folder) => {
      if (templates === null) throw new Error("templates are missing in the source tree");
      const made = await scaffoldExtension(
        {
          kind: "single-plugin",
          name: "appdemo",
          dir: folder,
          mode: "app",
          purpose: "Keep a list",
          description: "A small list app",
        },
        { templates },
      );
      if (!made.ok) throw new Error(made.error.message);
    },
  },
];

for (const shape of SHAPES) {
  realTest(
    `a ${shape.name} draft with a tool loads under its internal name and its tool asks for approval`,
    async () => {
      const home = useEngineHome();
      writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
      const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-draft-shape-")));
      const folder = join(workspace, "draft-folder");
      await shape.make(folder);
      const previousCwd = process.cwd();
      process.chdir(workspace);
      const host = await startInProcessHost({
        devChecks: true,
        pluginHost: isolatedPluginHost(),
        buildModels: callingModels("shape", [{ name: shape.tool, args: shape.args }], "done."),
      });
      const connection = createHostConnection(host.client);
      const collector = collectEvents(connection);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        const made = await connection.request("plugin.draft.create", { dir: folder });
        const created = await connection.request("thread.create", { workspace });
        const started = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: "use it",
          overlay: [{ plugin: shape.name, draftId: made.draftId }],
        });
        expect(typeof started.turnId).toBe("string");
        const asked = await collector.waitFor(
          (event) => event.kind === "approval.requested",
          60_000,
        );
        expect(asked.payload).toMatchObject({
          body: { kind: "tool", tool: { toolName: shape.tool } },
        });
      } finally {
        await connection.close();
        await host.close();
        process.chdir(previousCwd);
        rmSync(workspace, { recursive: true, force: true });
        home.dispose();
      }
    },
    120_000,
  );
}
