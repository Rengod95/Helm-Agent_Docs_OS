import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.5.10 (int): 대화의 프로필이 켠 플러그인의 MCP 서버가 그 대화의 서버 목록에 든다. 서버 id는 `<플러그인>-<이름>`[제안]이다.
// 플러그인을 프로필에서 빼면 그 대화의 다음 턴부터 목록에서 빠진다. 서버 명령은 없는 실행 파일이라 연결은 실패하지만 항목은 남는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KIT = "mcp-kit";
const PROFILE = "mcp-kit-profile";
const SERVER = `${KIT}-docs`;
const SERVER_COMMAND = "mcp-kit-missing-server-binary";
const SOURCE = `ext:${KIT}`;

/** 빈 내장 확장의 진입점. 로더가 같은 이름을 실어 프로필 검증의 구성원이 되게 한다 */
const membershipEntry: ExtensionEntry = ({ manifest: loaded, register }) => {
  register(loaded.name, {}, () => {});
};

function membershipModule(): HostPluginModule {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: KIT,
    version: "1.0.0",
    plugins: [{ layer: "plugin", hooks: [] }],
    defaultEnabled: false,
    trust: { level: "builtin" },
  });
  return { manifest, extension: membershipEntry };
}

/** 사용자 플러그인 폴더 하나: MCP 서버 정의 하나(검토본 `mcp.json`). 기본 프로필에는 넣지 않는다 */
function writeKit(home: EngineHome): void {
  const root = join(home.root, "config", "plugins", KIT);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: KIT,
      version: "1.0.0",
      purpose: "MCP integration",
      description: "MCP integration (test fixture).",
      defaultEnabled: false,
    }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({ mcpServers: { docs: { command: SERVER_COMMAND, args: ["--stdio"] } } }),
  );
}

interface KitSession {
  /** 대화 하나에 턴 하나를 돌리고 끝날 때까지 기다린다 */
  turn(thread: ThreadId, input: string): Promise<void>;
  /** 대화의 서버 목록(`mcp.servers`)에 든 서버 id와 출처 */
  serversOf(
    thread: ThreadId,
  ): Promise<readonly { readonly server: string; readonly source: string }[]>;
  /** 프로필에서 플러그인을 뺀다 */
  removeKit(): Promise<void>;
  threadOnKit: ThreadId;
  threadOnDefault: ThreadId;
  close(): Promise<void>;
}

async function openKit(): Promise<KitSession> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-plugin-mcp-")));
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  const model = recordingModels("plugin-mcp", ["one.", "two.", "three.", "four."], {
    contextWindow: 200_000,
    midConversationSystem: true,
  });
  const previousCwd = process.cwd();
  process.chdir(workspace);

  // 1차 기동: 폴더를 검토에 올려 승인한다
  const first = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: model.buildModels,
  });
  const firstConnection = createHostConnection(first.client);
  await firstConnection.request("host.hello", HELLO_PARAMS);
  writeKit(home);
  const scanned = await firstConnection.request("plugin.scan", {});
  const itemId = scanned.queued[0];
  if (itemId === undefined) throw new Error("plugin.scan queued no review item for the kit");
  const decided = await firstConnection.request("pluginReview.decide", {
    itemId,
    decision: { kind: "approve", profileIds: [], libraryOnly: true },
  });
  expect(decided.item.state).toBe("approved");
  await firstConnection.close();
  await first.close();

  // 2차 기동: 승인된 검토본에서 실린다. 라이브러리 구성원이 있어야 프로필이 이 이름을 받는다
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [membershipModule()],
    buildModels: model.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });

  const put = await connection.request("profile.put", {
    profile: {
      id: PROFILE,
      title: "MCP kit",
      // `cap-mcp`는 서버를 대화마다 다시 읽는 `boundary.step.before` 훅을 받아야 한다. 새 프로필에는 직접 적어야 켜진다(cap-knowledge와 같다)
      plugins: [{ name: KIT }, { name: "cap-mcp" }],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
  let rev = put.profile.rev;

  const onKit = await connection.request("thread.create", { workspace });
  await connection.request("thread.setProfile", { threadId: onKit.threadId, profileId: PROFILE });
  const onDefault = await connection.request("thread.create", {
    workspace,
    profileId: "default",
  });

  return {
    threadOnKit: onKit.threadId,
    threadOnDefault: onDefault.threadId,
    async turn(thread, input) {
      const started = await startTurnWhenIdle(connection, { threadId: thread, input });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
    },
    async serversOf(thread) {
      const listed = await connection.request("mcp.servers", { threadId: thread });
      return listed.servers.map((row) => ({ server: row.server, source: row.source }));
    },
    async removeKit() {
      const removed = await connection.request("profile.removePlugin", {
        id: PROFILE,
        plugin: KIT,
        baseRev: rev,
      });
      rev = removed.profile.rev;
    },
    async close() {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    },
  };
}

realTest(
  "an enabled plugin's MCP server is in the server list of its thread, and not in the list of a thread on the default profile",
  async () => {
    const session = await openKit();
    try {
      await session.turn(session.threadOnKit, "hello");
      expect(await session.serversOf(session.threadOnKit)).toEqual([
        { server: SERVER, source: SOURCE },
      ]);
      await session.turn(session.threadOnDefault, "hello from the default profile");
      expect(await session.serversOf(session.threadOnDefault)).toEqual([]);
    } finally {
      await session.close();
    }
  },
  60_000,
);

realTest(
  "removing the plugin from the profile drops its server from the thread's list at the next turn",
  async () => {
    const session = await openKit();
    try {
      await session.turn(session.threadOnKit, "first");
      expect(await session.serversOf(session.threadOnKit)).toEqual([
        { server: SERVER, source: SOURCE },
      ]);
      await session.removeKit();
      await session.turn(session.threadOnKit, "second");
      expect(await session.serversOf(session.threadOnKit)).toEqual([]);
    } finally {
      await session.close();
    }
  },
  60_000,
);
