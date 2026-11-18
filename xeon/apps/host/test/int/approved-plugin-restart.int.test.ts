import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.1.11, §4.5.2, §4.6 (int, 실제 엔진): 사용자 폴더 플러그인을 검토에서 승인하면 다음 시작의 로더 목록(`ext.list`)에 오르고,
// 그 이름을 프로필에 넣을 수 있으며, 그 프로필의 대화를 열면 코드가 실린다. 코드가 있는 것과 코드가 없는 것(지침과 스킬만 있고 엔트리가 없다)
// 둘 다 본다. 두 번 기동한다: 1차에서 검토해 승인하고, 2차는 같은 엔진 홈을 다시 연다. 기본 그룹을 끄지 않는다(끄면 외부 확장을 싣지 않는다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CODE = "restart-code";
const FOLDER = "restart-folder";
const CODE_PROFILE = "restart-code-profile";
const FOLDER_PROFILE = "restart-folder-profile";
/** 스킬 색인은 `cap-knowledge` 훅을 받는 대화에서만 돈다. 프로필이 그것을 켜야 한다 */
const KNOWLEDGE = "cap-knowledge";
const INSTRUCTION = "RESTART-INSTRUCTION-3b9e";
const SKILL = "restart-skill";
const SKILL_DESCRIPTION = "Restart skill description 8e20";

/** 사용자 플러그인 폴더는 `<config>/plugins/<이름>`이다. 설정 폴더는 호스트가 0700으로 만든다 */
function userPluginRoot(home: EngineHome, name: string): string {
  mkdirSync(join(home.root, "config"), { recursive: true, mode: 0o700 });
  return join(home.root, "config", "plugins", name);
}

/** 코드가 있는 사용자 플러그인(`defaultEnabled: false`). 엔트리가 실행되면 `marker`에 파일을 쓴다 */
function writeCodePlugin(home: EngineHome, marker: string): void {
  const root = userPluginRoot(home, CODE);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: CODE,
      version: "1.0.0",
      purpose: "Approved code plugin",
      defaultEnabled: false,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
export const extension = ({ register }) => {
  writeFileSync(${JSON.stringify(marker)}, "loaded");
  register(${JSON.stringify(CODE)}, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`,
  );
}

/** 코드가 없는 사용자 플러그인: 매니페스트, 지침 파일 하나, 스킬 하나. 엔트리가 없다 */
function writeFolderPlugin(home: EngineHome): void {
  const root = userPluginRoot(home, FOLDER);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: FOLDER,
      version: "1.0.0",
      purpose: "Approved instruction-only plugin",
      defaultEnabled: false,
    }),
  );
  writeFileSync(join(root, "instructions.md"), `${INSTRUCTION}: 항상 이 지침을 따른다.\n`);
  mkdirSync(join(root, "skills", SKILL), { recursive: true });
  writeFileSync(
    join(root, "skills", SKILL, "SKILL.md"),
    `---\nname: ${SKILL}\ndescription: ${SKILL_DESCRIPTION}\n---\n스킬 본문\n`,
  );
}

type Connection = ReturnType<typeof createHostConnection>;

/** 검토함을 훑고 이름이 맞는 항목을 보관만 하도록 승인한다(프로필에는 넣지 않는다) */
async function approveByName(connection: Connection, name: string): Promise<void> {
  await connection.request("plugin.scan", {});
  const listed = await connection.request("pluginReview.list", {});
  const item = listed.items.find((entry) => entry.name === name);
  if (item === undefined) throw new Error(`the review inbox has no item for ${name}`);
  const decided = await connection.request("pluginReview.decide", {
    itemId: item.itemId,
    decision: { kind: "approve", profileIds: [], libraryOnly: true },
  });
  expect(decided.item.state).toBe("approved");
}

/** 같은 엔진 홈을 여는 기본 조립. 격리 샌드박스는 이 기기에서 시험할 수 없어 엔진 안에서 돈다 */
function startHost(model: ReturnType<typeof recordingModels>) {
  return startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    buildModels: model.buildModels,
  });
}

realTest(
  "an approved user-folder plugin with code is in ext.list after a restart, can be put in a profile, and loads when a thread on that profile opens",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-approved-code-")));
    const marker = join(workspace, "code.marker");
    writeCodePlugin(home, marker);
    const model = recordingModels("approved-code", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const first = await startHost(model);
      const firstConnection = createHostConnection(first.client);
      await firstConnection.request("host.hello", HELLO_PARAMS);
      await approveByName(firstConnection, CODE);
      // 승인은 적재가 아니다(§4.1.11): 어느 프로필에도 넣지 않은 승인만으로는 코드가 돌지 않는다
      expect(existsSync(marker)).toBe(false);
      await firstConnection.close();
      await first.close();
      expect(existsSync(marker)).toBe(false);

      const host = await startHost(model);
      const connection = createHostConnection(host.client);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        const listed = await connection.request("ext.list", {});
        expect(listed.extensions.find((entry) => entry.name === CODE)?.origin).toBe("user");

        await connection.request("profile.put", {
          profile: {
            id: CODE_PROFILE,
            title: "Code",
            plugins: [{ name: CODE }],
            settings: [],
            startDrive: null,
          },
          baseRev: null,
        });
        // 대화가 아직 쓰지 않았으므로 코드는 돌지 않는다
        expect(existsSync(marker)).toBe(false);

        // 그 프로필로 대화를 연다. 열 때 적재를 기다리므로 만든 뒤 바로 표지가 있다
        const opened = await connection.request("thread.create", {
          workspace,
          profileId: CODE_PROFILE,
        });
        expect(existsSync(marker)).toBe(true);
        // 그 대화에서 목록의 켜짐 출처는 프로필이고 상태는 켜짐이다
        const onThread = await connection.request("ext.list", { threadId: opened.threadId });
        const entry = onThread.extensions.find((item) => item.name === CODE);
        expect(entry?.status).toBe("enabled");
        expect(entry?.plugins.map((plugin) => plugin.enabledSource)).toEqual(["profile"]);
      } finally {
        await connection.close();
        await host.close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "an approved user-folder plugin with no code (instructions and a skill) is in ext.list after a restart, can be put in a profile, and its materials reach a turn on that profile",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-approved-folder-")));
    writeFolderPlugin(home);
    const model = recordingModels("approved-folder", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const first = await startHost(model);
      const firstConnection = createHostConnection(first.client);
      await firstConnection.request("host.hello", HELLO_PARAMS);
      await approveByName(firstConnection, FOLDER);
      await firstConnection.close();
      await first.close();

      const host = await startHost(model);
      const connection = createHostConnection(host.client);
      const collector = collectEvents(connection);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        const listed = await connection.request("ext.list", {});
        expect(listed.extensions.find((entry) => entry.name === FOLDER)?.origin).toBe("user");

        await connection.request("profile.put", {
          profile: {
            id: FOLDER_PROFILE,
            title: "Folder",
            plugins: [{ name: FOLDER }, { name: KNOWLEDGE }],
            settings: [],
            startDrive: null,
          },
          baseRev: null,
        });
        const created = await connection.request("thread.create", { workspace });
        await connection.request("thread.setProfile", {
          threadId: created.threadId,
          profileId: FOLDER_PROFILE,
        });
        const started = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: "hello",
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        );
        // 전환의 적용은 다음 경계에서 끝난다. 턴이 끝난 뒤 그 대화에서 목록의 켜짐 출처는 프로필이다
        const onThread = await connection.request("ext.list", { threadId: created.threadId });
        const entry = onThread.extensions.find((item) => item.name === FOLDER);
        expect(entry?.plugins.map((plugin) => plugin.enabledSource)).toEqual(["profile"]);
        expect(entry?.status).toBe("enabled");
        const body = model.requestBodies()[0] ?? "";
        expect(model.requestBodies()).toHaveLength(1);
        expect(body).toContain(INSTRUCTION);
        expect(body).toContain(`<name>${SKILL}</name>`);
        expect(body).toContain(SKILL_DESCRIPTION);
      } finally {
        await connection.close();
        await host.close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
