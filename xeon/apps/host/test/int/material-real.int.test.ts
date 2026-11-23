import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.5.10 (int): 대화의 프로필이 켠 플러그인의 재료가 실제 턴의 모델 요청에 실린다. 지침은 접두 절로, 스킬은 스킬 색인으로 간다.
// 플러그인을 프로필에서 빼면 다음 턴부터 그 재료가 요청에서 빠진다. 실제 엔진이 필요하고, 모델은 요청을 받아 적는 테이프다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KIT = "mat-kit";
/** 지침 절의 키. `plugin:<플러그인>:<경로>`(M5c §4.5.10) */
const INSTRUCTION_KEY = `plugin:${KIT}:instructions.md`;
/** 스킬 색인(cap-knowledge)도 프로필이 켜야 훅을 받는다. 기본 프로필에는 들지만 새 프로필에는 직접 적어야 한다 */
const KNOWLEDGE = "cap-knowledge";
const PROFILE = "kit";
const INSTRUCTION = "MATERIAL-INSTRUCTION-7d2c";
const SKILL = "mat-skill";
const SKILL_DESCRIPTION = "Material skill description 4f1a";

/** 사용자 플러그인 폴더 하나: 지침 파일 하나와 스킬 하나. 기본 프로필에는 넣지 않는다(`defaultEnabled: false`) */
function writeKit(home: EngineHome): void {
  const root = join(home.root, "config", "plugins", KIT);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: KIT,
      version: "1.0.0",
      purpose: "Material integration",
      description: "Material integration (test fixture).",
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 모델이 보는 시스템 절: 요청 본문의 시스템 메시지를 앞에서부터 합친 값이다. 이름별로 덮고 `null`이면 지운다. 기록된 접두의 절은
 * 그대로 두고 바뀐 것만 뒤 메시지로 오므로(L1.context §4.1), 모델 쪽 어댑터가 이 규칙으로 합쳐 보낸다(`replaySystemMessages`와 같다)
 */
function sectionsSeenByModel(body: string): ReadonlyMap<string, string> {
  const parsed: unknown = JSON.parse(body);
  const messages: unknown = isRecord(parsed) ? parsed["messages"] : undefined;
  const list: readonly unknown[] = Array.isArray(messages) ? messages : [];
  const sections = new Map<string, string>();
  for (const message of list) {
    if (!isRecord(message)) continue;
    const found = message["sections"];
    if (!isRecord(found)) continue;
    for (const [name, value] of Object.entries(found)) {
      if (value === null) sections.delete(name);
      else if (typeof value === "string") sections.set(name, value);
    }
  }
  return sections;
}

interface KitSession {
  /** 대화 하나에 턴 하나를 돌리고 끝날 때까지 기다린다 */
  turn(thread: ThreadId, input: string): Promise<void>;
  /** 턴마다 모델이 받은 요청 본문. 첫 번째가 첫 턴이다 */
  requests(): readonly string[];
  /** 프로필 `kit`에 든 플러그인을 뺀다. `baseRev`는 저장된 프로필의 rev다 */
  removeKit(): Promise<void>;
  threadOnKit: ThreadId;
  threadOnDefault: ThreadId;
  close(): Promise<void>;
}

/**
 * 플러그인을 검토해 승인하고, 프로필 `kit`에 넣은 뒤 대화 둘을 연다. 하나는 `kit`을 쓰고 다른 하나는 기본 프로필을 쓴다.
 * 모델은 턴마다 답을 하나씩 내고 요청 본문을 적는다
 */
async function openKit(): Promise<KitSession> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-material-")));
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  // 대화 중 system 메시지를 받는 모델: 플러그인을 뺀 절 갱신이 다음 턴 요청에 바로 든다
  const model = recordingModels("material", ["one.", "two.", "three.", "four."], {
    contextWindow: 200_000,
    midConversationSystem: true,
  });
  const previousCwd = process.cwd();
  process.chdir(workspace);

  // 1차 기동: 폴더를 검토에 올려 승인한다. 승인하면 검토본 사본과 현재 가리킴이 생긴다
  const first = await startInProcessHost({
    devChecks: true,
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

  // 2차 기동: 같은 엔진 홈을 다시 연다. 프로필 검증은 로더의 확장 목록을 보고, 이 플러그인은 승인 뒤 그 목록에 있다.
  // 재료는 승인된 검토본 폴더에서 온다
  const host = await startInProcessHost({
    devChecks: true,
    buildModels: model.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });

  const put = await connection.request("profile.put", {
    profile: {
      id: PROFILE,
      title: "Kit",
      plugins: [{ name: KIT }, { name: KNOWLEDGE }],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
  let rev = put.profile.rev;

  const onKit = await connection.request("thread.create", { workspace });
  await connection.request("thread.setProfile", { threadId: onKit.threadId, profileId: PROFILE });
  // 같은 폴더의 대화는 폴더의 기본 프로필(방금 고른 `kit`)을 물려받는다. 대조군은 `default`를 명시한다
  const onDefault = await connection.request("thread.create", {
    workspace,
    profileId: "default",
  });

  return {
    threadOnKit: onKit.threadId,
    threadOnDefault: onDefault.threadId,
    requests: () => model.requestBodies(),
    async turn(thread, input) {
      const started = await startTurnWhenIdle(connection, { threadId: thread, input });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
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
  "an enabled plugin's instruction text is in the model request of a turn on its profile, and not in a turn on the default profile",
  async () => {
    const session = await openKit();
    try {
      await session.turn(session.threadOnKit, "hello");
      expect(session.requests()).toHaveLength(1);
      expect(sectionsSeenByModel(session.requests()[0] ?? "").get(INSTRUCTION_KEY)).toContain(
        INSTRUCTION,
      );
      await session.turn(session.threadOnDefault, "hello from the default profile");
      expect(session.requests()).toHaveLength(2);
      expect(sectionsSeenByModel(session.requests()[1] ?? "").has(INSTRUCTION_KEY)).toBe(false);
    } finally {
      await session.close();
    }
  },
  60_000,
);

realTest(
  "removing the plugin from the profile takes its instruction out of the next turn's request",
  async () => {
    const session = await openKit();
    try {
      await session.turn(session.threadOnKit, "first");
      expect(session.requests()[0]).toContain(INSTRUCTION);
      await session.removeKit();
      await session.turn(session.threadOnKit, "second");
      // 기록된 접두에는 지침이 남아 요청 본문에 그대로 보인다. 제거는 `null` 절로 뒤에 온다. 모델이 보는 절에서는 빠진다
      expect(sectionsSeenByModel(session.requests()[0] ?? "").get(INSTRUCTION_KEY)).toContain(
        INSTRUCTION,
      );
      expect(sectionsSeenByModel(session.requests()[1] ?? "").has(INSTRUCTION_KEY)).toBe(false);
    } finally {
      await session.close();
    }
  },
  60_000,
);

realTest(
  "a plugin's skill is in the skill index of its thread's first turn and the index delta drops it after the plugin is removed",
  async () => {
    const session = await openKit();
    try {
      await session.turn(session.threadOnKit, "first");
      expect(session.requests()[0]).toContain(`<name>${SKILL}</name>`);
      expect(session.requests()[0]).toContain(SKILL_DESCRIPTION);
      await session.removeKit();
      await session.turn(session.threadOnKit, "second");
      // 인덱스가 바뀌면 다음 턴에 델타 한 줄이 간다. 삭제된 스킬 이름이 그 줄에 든다
      expect(session.requests()[1]).toContain(`스킬 인덱스 변경: 삭제 ${SKILL}`);
    } finally {
      await session.close();
    }
  },
  60_000,
);
