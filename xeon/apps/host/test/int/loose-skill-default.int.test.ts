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
import { parseJson } from "@fresnel/contracts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §7.5, 사용자 결정 2026-11-18(AGE-41) (int, 실제 엔진): 느슨한 스킬 폴더를 옮긴 스킬은 공통 묶음에 들어 모든 프로필의 대화가 쓴다.
// 저장된 기본 프로필은 바뀌지 않는다. 사용자가 공통 묶음에서 뺀 뒤 다음 시작에는 다시 넣지 않는다.
// 기본 프로필을 저장해 두고(공장 값이 아니라) 스킬 폴더를 둔 뒤 기동한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SKILL = "loose-kit";
const SKILL_DESCRIPTION = "Loose skill description 5c7d";
/** 저장하는 기본 프로필의 플러그인 이름. 옮김 뒤에도 이 목록 그대로여야 한다 */
const STORED_DEFAULT = ["cap-workspace", "cap-dialog", "cap-knowledge"];

/** 줄 값의 한 칸. 객체가 아니거나 칸이 없으면 undefined다 */
function fieldOf(line: unknown, key: string): unknown {
  if (typeof line !== "object" || line === null) return undefined;
  return Object.entries(line).find(([name]) => name === key)?.[1];
}

realTest(
  "a loose skill folder moved at a start joins the common set: a thread sees it, the stored default profile stays as it was, and removing it from the common set sticks",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-loose-skill-")));
    const model = recordingModels("loose-skill", ["one.", "two."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const migrationLog = join(home.root, "state", "migration.log");
    const startHost = () =>
      startInProcessHost({
        devChecks: true,
        pluginHost: { disabled: true },
        buildModels: model.buildModels,
      });
    try {
      // 1차 기동: 기본 프로필을 저장해 둔다. 저장된 기본 프로필은 공장 값을 따라가지 않는다
      const first = await startHost();
      const firstConnection = createHostConnection(first.client);
      await firstConnection.request("host.hello", HELLO_PARAMS);
      // 저장하는 기본 프로필은 코어가 요구하는 두 단위와 `cap-knowledge`(스킬 색인이 이 훅을 받는다)만 든다.
      // 공장 목록은 이 기기에 없는 번들 이름을 적어 검증이 막으므로 쓰지 않는다
      const stored = await firstConnection.request("profile.put", {
        profile: {
          id: "default",
          title: "default",
          plugins: STORED_DEFAULT.map((name) => ({ name })),
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      expect(stored.profile.plugins.map((plugin) => plugin.name)).toEqual(STORED_DEFAULT);
      const commonBefore = await firstConnection.request("profile.common.get", {});
      expect(commonBefore.common.plugins).toEqual([]);
      await firstConnection.close();
      await first.close();

      // 스킬 폴더를 둔다. 다음 시작이 옮긴다
      const skillDir = join(home.dataDir, "skills", SKILL);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${SKILL}\ndescription: ${SKILL_DESCRIPTION}\n---\n스킬 본문\n`,
      );

      // 2차 기동: 옮기고, 공통 묶음에 넣는다. 저장된 기본 프로필은 그대로다. 그 대화가 스킬을 본다
      const second = await startHost();
      const secondConnection = createHostConnection(second.client);
      const collector = collectEvents(secondConnection);
      await secondConnection.request("host.hello", HELLO_PARAMS);
      await secondConnection.request("events.subscribe", { from: "head" });
      const commonOnSecond = await secondConnection.request("profile.common.get", {});
      expect(commonOnSecond.common.plugins.map((plugin) => plugin.name)).toEqual([SKILL]);
      const onDefault = await secondConnection.request("profile.get", { id: "default" });
      expect(onDefault.profile.plugins.map((plugin) => plugin.name)).toEqual(STORED_DEFAULT);
      expect(onDefault.profile.rev).toBe(stored.profile.rev);
      // 옮긴 스킬의 원본 폴더는 그대로 있으므로 검토함에 제거 항목이 생기지 않는다
      const inbox = await secondConnection.request("pluginReview.list", {});
      expect(inbox.items.map((item) => [item.name, item.kind, item.state])).toEqual([]);
      const created = await secondConnection.request("thread.create", { workspace });
      const started = await startTurnWhenIdle(secondConnection, {
        threadId: created.threadId,
        input: "hello",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
      expect(model.requestBodies()[0] ?? "").toContain(`<name>${SKILL}</name>`);
      expect(model.requestBodies()[0] ?? "").toContain(SKILL_DESCRIPTION);
      // 사용자가 공통 묶음에서 뺀다
      await secondConnection.request("profile.common.put", {
        common: { plugins: [], settings: [] },
        baseRev: commonOnSecond.common.rev,
      });
      await secondConnection.close();
      await second.close();

      // 3차 기동: 옮김 기록이 있으므로 다시 넣지 않는다. 저장된 기본 프로필은 여전히 그대로다
      const third = await startHost();
      const thirdConnection = createHostConnection(third.client);
      await thirdConnection.request("host.hello", HELLO_PARAMS);
      const commonAfter = await thirdConnection.request("profile.common.get", {});
      expect(commonAfter.common.plugins).toEqual([]);
      const after = await thirdConnection.request("profile.get", { id: "default" });
      expect(after.profile.plugins.map((plugin) => plugin.name)).toEqual(STORED_DEFAULT);
      expect(after.profile.rev).toBe(stored.profile.rev);
      await thirdConnection.close();
      await third.close();

      // 옮김 기록에 이 이름의 옮김 줄과 공통 묶음 줄이 하나씩 있다
      expect(existsSync(migrationLog)).toBe(true);
      const lines = readFileSync(migrationLog, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => parseJson(line))
        .flatMap((json) => (json.ok ? [json.value] : []));
      expect(
        lines
          .filter((line) => fieldOf(line, "name") === SKILL)
          .map((line) => [fieldOf(line, "step"), fieldOf(line, "outcome")]),
      ).toEqual([
        ["loose_skill", "migrated"],
        ["loose_skill_profile", "migrated"],
      ]);
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  120_000,
);
