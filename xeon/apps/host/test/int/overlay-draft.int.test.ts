import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { internalDraftName } from "@fresnel/ext-host";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.3.8, U2 결정(2026-11-17) (int, 실제 엔진): 초안 덧씌우기.
// (a) 격리 포트가 없으면(`pluginHost.disabled`) 초안 덧씌우기는 `overlay.draftUnavailable`이고, 초안의 어떤 것도 싣지 않는다.
// (b) 실제 격리(플러그인 호스트 자식)에서 초안을 싣고, 그 초안의 도구 호출은 `bypass` 대화에서도 승인 카드를 띄운다(`draft` 표지).
//     카드가 승인되기 전에는 도구가 돌지 않는다. 승인하면 도구가 자식에서 돈다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const DRAFT = "draft-probe";
const TOOL = "draftprobe_tick";

/** 초안 폴더(사용자 플러그인 폴더 밖, 작업 폴더 아래). 도구 하나를 그룹 SDK로 등록하고 실행하면 표지 파일을 쓴다 */
function writeDraftFolder(root: string, marker: string): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: DRAFT,
      version: "1.0.0",
      purpose: "Draft tool for the overlay draft test",
      defaultEnabled: false,
      entry: "./src/index.ts",
      orchestration: {},
      plugins: [{ layer: "L3", hooks: [], requires: [], optional: [] }],
    }),
  );
  // 초안은 내부 이름으로 실리므로 진입점은 받은 매니페스트의 이름으로 등록한다
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
import { Type } from "typebox";
import { defineOrchestration, orchestrationManifest } from "@fresnel/group-sdk";
export const extension = (ctx) => {
  const group = defineOrchestration({
    manifest: orchestrationManifest({
      schemaVersion: 2,
      name: ctx.manifest.name,
      version: "1.0.0",
      entry: "./src/index.ts",
      orchestration: {},
      plugins: [{ layer: "L3", hooks: [], requires: [], optional: [] }],
    }),
    setup(g) {
      g.registerTool({
        name: ${JSON.stringify(TOOL)},
        description: "Write the marker when run",
        parameters: Type.Object({}),
        replay: "safe",
        execute: () => {
          writeFileSync(${JSON.stringify(marker)}, "ran");
          return Promise.resolve("ran");
        },
      });
    },
  });
  return group.entry(ctx);
};
`,
  );
}

/** 확장 목록에 그 이름이 없어질 때까지 기다린다. 기한을 넘기면 false다 */
async function unlisted(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    const listed = await connection.request("ext.list", {});
    if (!listed.extensions.some((entry) => entry.name === name)) return true;
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(20);
  }
  return false;
}

/** 초안을 만들고 식별자를 돌려준다. 검토하지 않는다 */
async function createDraft(
  connection: ReturnType<typeof createHostConnection>,
  folder: string,
): Promise<string> {
  const made = await connection.request("plugin.draft.create", { dir: folder });
  return made.draftId;
}

realTest(
  "a draft overlay with no isolated plugin host is refused with overlay.draftUnavailable, and nothing of the draft is loaded",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-overlay-draft-a-")));
    const marker = join(workspace, "tool.marker");
    const folder = join(workspace, "draft-folder");
    writeDraftFolder(folder, marker);
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: callingModels("overlay-draft-a", [{ name: TOOL, args: {} }], "done."),
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const draftId = await createDraft(connection, folder);
      const created = await connection.request("thread.create", { workspace });
      const refused = await rejectionOf(
        connection.request("turn.start", {
          threadId: created.threadId,
          input: "use it",
          overlay: [{ plugin: DRAFT, draftId }],
        }),
      );
      expect(refused).toMatchObject({ data: { kind: "overlay.draftUnavailable" } });
      // 격리가 없으니 초안은 어디에도 실리지 않는다: 목록에 없고, 턴도 돌지 않는다
      const listed = await connection.request("ext.list", {});
      expect(
        listed.extensions.some((entry) => entry.name === internalDraftName(DRAFT, draftId)),
      ).toBe(false);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "under the real isolated plugin host a draft tool asks for approval with a draft mark even in bypass, does not run until allowed, and runs in its child after",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-overlay-draft-b-")));
    const marker = join(workspace, "tool.marker");
    const folder = join(workspace, "draft-folder");
    writeDraftFolder(folder, marker);
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: isolatedPluginHost(),
      buildModels: callingModels("overlay-draft-b", [{ name: TOOL, args: {} }], "done."),
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const draftId = await createDraft(connection, folder);
      const created = await connection.request("thread.create", { workspace });
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "use it",
        overlay: [{ plugin: DRAFT, draftId }],
      });
      expect(typeof started.turnId).toBe("string");

      // 초안 출신 호출은 bypass에서도 카드를 띄운다. 카드에는 초안 표지가 있다
      const asked = await collector.waitFor((event) => event.kind === "approval.requested", 60_000);
      expect(asked.payload).toMatchObject({
        body: { kind: "tool", tool: { toolName: TOOL, draft: { plugin: DRAFT, draftId } } },
      });
      expect(existsSync(marker)).toBe(false);

      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
      await collector.waitFor((event) => event.kind === "turn.completed", 60_000);
      expect(existsSync(marker) ? readFileSync(marker, "utf8") : null).toBe("ran");

      // 기록: 덧씌우기가 켜지고(초안 표지를 싣는다) 턴이 정착하면 꺼진다. 꺼진 뒤 초안은 실리지 않는다
      const off = await collector.waitFor(
        (event) =>
          event.kind === "profile.applied" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "overlay_off",
        30_000,
      );
      expect(off.payload).toMatchObject({
        overlay: [{ plugin: DRAFT, draftId, until: "turn" }],
      });
      const on = collector.events.find(
        (event) =>
          event.kind === "profile.applied" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "overlay_on",
      );
      expect(on?.payload).toMatchObject({ overlay: [{ plugin: DRAFT, draftId, until: "turn" }] });
      // 내리기는 덧씌우기가 꺼진 뒤 대기열에서 돈다. 목록에서 빠질 때까지 기다린다
      expect(await unlisted(connection, internalDraftName(DRAFT, draftId), 10_000)).toBe(true);
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

const READER = "draft-reader";

/** 초안 폴더. 턴 끝 훅에서 읽기 전용 기능(`artifacts.registry.list`)을 부르고 결과를 표지 파일에 적는다 */
function writeReaderFolder(root: string, marker: string): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: READER,
      version: "1.0.0",
      purpose: "Draft hook that reads through a readOnly capability method",
      defaultEnabled: false,
      entry: "./src/index.ts",
      plugins: [
        {
          layer: "plugin",
          hooks: ["input.agent.before"],
          requires: [{ id: "artifacts.registry", range: "^1.0.0" }],
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
export const extension = ({ register, manifest }) => {
  register(manifest.name, {}, (g) => {
    g.on("input.agent.before", async () => {
      let outcome;
      try {
        const listed = await g.capability({ capability: "artifacts.registry", version: "1.0.0" }).list({});
        outcome = { ok: true, keys: Object.keys(listed).sort() };
      } catch (caught) {
        outcome = { ok: false, code: caught && caught.code, message: String(caught && caught.message).slice(0, 300) };
      }
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify(outcome));
    });
  });
};
`,
  );
}

realTest(
  "a draft hook's readOnly capability call does not run on the light path: it asks for approval with a draft mark in bypass, and reads only after the card is allowed",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-overlay-draft-c-")));
    const marker = join(workspace, "read.marker");
    const folder = join(workspace, "draft-folder");
    writeReaderFolder(folder, marker);
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: isolatedPluginHost(),
      buildModels: callingModels("overlay-draft-c", [], "done."),
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const draftId = await createDraft(connection, folder);
      const created = await connection.request("thread.create", { workspace });
      await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "read",
        overlay: [{ plugin: READER, draftId }],
      });

      const asked = await collector.waitFor((event) => event.kind === "approval.requested", 60_000);
      expect(asked.payload).toMatchObject({
        body: { kind: "tool", tool: { draft: { plugin: READER, draftId } } },
      });
      // 카드가 떠 있는 동안 기능은 불리지 않았다
      expect(existsSync(marker)).toBe(false);

      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
      await collector.waitFor((event) => event.kind === "turn.completed", 60_000);
      expect(existsSync(marker) ? readFileSync(marker, "utf8") : null).toBe(
        JSON.stringify({ ok: true, keys: ["items", "nextCursor"] }),
      );
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
