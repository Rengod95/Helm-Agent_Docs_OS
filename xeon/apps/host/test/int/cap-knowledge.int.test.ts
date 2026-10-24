import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { skillViewingModels } from "../fixtures/skill-tape.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 cap-knowledge (int): skill_view가 도구로 광고되고 사용자 스킬을 읽는다. 프로젝트 스킬(.xeon/skills)은 프로젝트를 신뢰한 경우에만 싣는다
// (결정 D6, 조립 루트가 projectTrust 옵션을 X의 resolveProjectTrust에 이은 것을 시험한다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

function skillFile(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Use when the test asks for ${name}.\n---\n${body}\n`;
}

/** 모델이 skill_view로 `skill`을 읽는 turn 하나를 돌리고 도구 결과 본문을 돌려준다 */
async function viewSkill(options: {
  readonly userSettings: Readonly<Record<string, unknown>>;
  readonly skill: string;
  readonly prepare: (dirs: { readonly dataDir: string; readonly workspace: string }) => void;
}): Promise<string> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...options.userSettings });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-kn-")));
  // 엔진은 데이터 디렉터리의 권한이 0700이 아니면 서지 않는다(L0.os)
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  options.prepare({ dataDir: home.dataDir, workspace });
  const previousCwd = process.cwd();
  // 엔진은 시작할 때의 작업 폴더를 프로젝트 디렉터리로 잡는다
  process.chdir(workspace);
  try {
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: skillViewingModels("knowledge", options.skill),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    await connection.request("turn.start", { threadId: created.threadId, input: "show the skill" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    const text = toolResultTexts(collector.events).join("\n");
    await connection.close();
    await host.close();
    return text;
  } finally {
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  }
}

/** 작업 폴더에 프로젝트 스킬 하나를 둔다 */
function prepareProjectSkill({ workspace }: { readonly workspace: string }): void {
  const dir = join(workspace, ".xeon", "skills", "proj-demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillFile("proj-demo", "project skill body marker"));
}

describe("skill_view", () => {
  realTest("reads a user skill from the data directory", async () => {
    const text = await viewSkill({
      userSettings: {},
      skill: "user-demo",
      prepare: ({ dataDir }) => {
        const dir = join(dataDir, "skills", "user-demo");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), skillFile("user-demo", "user skill body marker"));
      },
    });
    expect(text).toContain("user skill body marker");
  });

  realTest("a project skill loads only when the project is trusted", async () => {
    const trusted = await viewSkill({
      userSettings: { "x.loading-trust.defaultProjectTrust": "always" },
      skill: "proj-demo",
      prepare: prepareProjectSkill,
    });
    expect(trusted).toContain("project skill body marker");
    // 기본 정책이 ask이고 프롬프트를 띄울 클라이언트가 없으면 결정이 없다: 싣지 않는다(fail-closed)
    const untrusted = await viewSkill({
      userSettings: {},
      skill: "proj-demo",
      prepare: prepareProjectSkill,
    });
    expect(untrusted).not.toContain("project skill body marker");
    const denied = await viewSkill({
      userSettings: { "x.loading-trust.defaultProjectTrust": "never" },
      skill: "proj-demo",
      prepare: prepareProjectSkill,
    });
    expect(denied).not.toContain("project skill body marker");
  });
});
