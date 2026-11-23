import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

// M5c §4.3.2 (int, 실제 엔진): 프로필 밖의 검토된 플러그인 스킬을 턴 덧씌우기로 얹으면 그 턴의 `turn.started`가 얹은 항목을
// `invoked`에 싣는다. 덧씌우기가 없던 턴의 `turn.started`에는 `invoked` 필드가 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const FOLDER = "invoked-folder";
const SKILL = "invoked-skill";

/** 사용자 플러그인 폴더는 `<config>/plugins/<이름>`이다. 코드 없이 스킬 하나만 든 플러그인이다 */
function writeSkillPlugin(home: EngineHome): void {
  mkdirSync(join(home.root, "config"), { recursive: true, mode: 0o700 });
  const root = join(home.root, "config", "plugins", FOLDER);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: FOLDER,
      version: "1.0.0",
      purpose: "Skill-only plugin for the overlay invocation record",
      description: "Skill-only plugin for the overlay invocation record (test fixture).",
      defaultEnabled: false,
    }),
  );
  mkdirSync(join(root, "skills", SKILL), { recursive: true });
  writeFileSync(
    join(root, "skills", SKILL, "SKILL.md"),
    `---\nname: ${SKILL}\ndescription: Invoked skill 4c71\n---\n스킬 본문\n`,
  );
}

/** 검토함을 훑고 이름이 맞는 항목을 보관만 하도록 승인한다(프로필에는 넣지 않는다) */
async function approveByName(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
): Promise<void> {
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

realTest(
  "a turn started with a one-turn overlay records the invoked entry in turn.started.invoked, and a turn without an overlay has no invoked field",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-overlay-invoked-")));
    writeSkillPlugin(home);
    const model = recordingModels("overlay-invoked", ["one.", "two."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const host = await startInProcessHost({
        devChecks: true,
        pluginHost: { disabled: true },
        buildModels: model.buildModels,
      });
      const connection = createHostConnection(host.client);
      const collector = collectEvents(connection);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        await approveByName(connection, FOLDER);
        const created = await connection.request("thread.create", { workspace });

        // 프로필 밖의 스킬을 이번 턴에만 얹는다
        const overlaid = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: "use the skill",
          overlay: [{ plugin: FOLDER, entry: SKILL }],
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === overlaid.turnId,
        );
        const overlaidStart = collector.events.find(
          (event) => event.kind === "turn.started" && event.turnId === overlaid.turnId,
        );
        expect(overlaidStart?.payload).toEqual({
          inputItemIds: expect.any(Array),
          requestId: expect.any(String),
          scopeId: null,
          origin: "user",
          invoked: [{ plugin: FOLDER, entry: SKILL, kind: "skill" }],
        });

        // 덧씌우기 없이 시작한 턴에는 필드가 없다
        const plain = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: "plain",
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === plain.turnId,
        );
        const plainStart = collector.events.find(
          (event) => event.kind === "turn.started" && event.turnId === plain.turnId,
        );
        expect(plainStart?.payload).toEqual({
          inputItemIds: expect.any(Array),
          requestId: expect.any(String),
          scopeId: null,
          origin: "user",
        });
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
