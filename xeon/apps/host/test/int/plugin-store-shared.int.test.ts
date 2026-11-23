import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { locateTemplateDirs, scaffoldExtension } from "@fresnel/core-authoring";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { isRecord, rawClient } from "../fixtures/raw-client.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 앱 뼈대(`authoring_scaffold` mode `app`)가 만든 플러그인의 항목 목록은 플러그인 전용 저장소(`g.pluginStore`, 키 `items`)에 산다.
// 조립된 호스트에서 (1) 뼈대를 만들어 승인하고, (2) 대화에서 모델이 `<이름>_add_item` 도구로 항목을 더하면, (3) 대화 없이 wire의
// `ext.<이름>.list`가 그 항목을 값으로 돌려주고, (4) 제거를 요청하면 제거 항목의 미리 보기가 `removes.state`를 참으로 준다.
// 모델은 테이프다. 확인은 모두 값 비교다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const templates = locateTemplateDirs({});
const NAME = "aa-items";
const TOOL = "aa_items_add_item";
const PROFILE = "shared-store";
const TITLE = "milk";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Connection = ReturnType<typeof createHostConnection>;

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return {};
  return value;
}

realTest(
  "an approved app skeleton keeps its items in the plugin store: a conversation's model tool adds one, a method with no conversation lists it, and a removal request shows removes.state true",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = realpathSync(home.root);
    const work = join(root, "work");
    const folder = join(root, "drafts", NAME);
    mkdirSync(work, { recursive: true });
    if (templates === null) throw new Error("templates are missing in the source tree");

    // (1) 앱 뼈대를 폴더에 만든다. 목적과 설명을 넣어 두므로 채우기 단계가 필요 없다
    const made = await scaffoldExtension(
      {
        kind: "single-plugin",
        name: NAME,
        dir: folder,
        mode: "app",
        purpose: "Keep a shared list",
        description: "A small list app whose items live in the plugin store",
      },
      { templates },
    );
    if (!made.ok) throw new Error(made.error.message);

    // 모델: 첫 답은 도구 호출, 둘째 답은 끝말이다
    const call: JsonObject = { title: TITLE };
    const player = tapePlayer(
      tape("plugin-store-shared", [
        {
          role: "main" as const,
          label: "add item",
          response: {
            type: "message" as const,
            content: [t.toolCall(TOOL, call, "call_add")],
            stopReason: "toolUse" as const,
          },
        },
        {
          role: "main" as const,
          label: "done",
          response: {
            type: "message" as const,
            content: [t.text("added.")],
            stopReason: "stop" as const,
          },
        },
      ]),
      { clock: realTapeClock() },
    );

    const previousCwd = process.cwd();
    process.chdir(work);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: tapeBuildModels(tapeProvider(player)),
    });
    const connection: Connection = createHostConnection(host.client);
    const raw = rawClient(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      // 설치 화면과 같은 길로 승인한다: 초안을 만들고 검토함에 제출한 뒤, 새 프로필에 넣어 승인한다
      const draft = await connection.request("plugin.draft.create", { dir: folder });
      const submitted = await connection.request("pluginReview.submitDraft", {
        draftId: draft.draftId,
      });
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Shared store",
          plugins: [],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const decided = await connection.request("pluginReview.decide", {
        itemId: submitted.itemId,
        decision: { kind: "approve", profileIds: [PROFILE], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual([PROFILE]);

      // (2) 대화에서 모델이 도구로 항목을 더한다
      const created = await connection.request("thread.create", {
        workspace: work,
        profileId: PROFILE,
      });
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "add milk",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
      expect(player.remaining()).toBe(0);

      // (3) 대화 없이 읽기 메서드를 부른다. 같은 저장소의 같은 항목이 보이고, 날짜는 YYYY-MM-DD 모양이다
      const listId = "list-without-thread";
      await raw.send({ jsonrpc: "2.0", id: listId, method: `ext.${NAME}.list`, params: {} });
      const listed = await raw.response(listId);
      expect(recordOf(listed.message)["result"]).toEqual({
        ok: true,
        items: [{ title: TITLE, created: expect.stringMatching(DAY) }],
      });

      // (4) 제거를 요청하면 제거 항목이 생기고, 미리 보기는 저장소에 값이 있다고 말한다
      const requested = await connection.request("plugin.requestRemove", { name: NAME });
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      const entry = pending.items.find((item) => item.itemId === requested.itemId);
      expect([entry?.kind, entry?.removal?.removes.state]).toEqual(["remove", true]);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      home.dispose();
    }
  },
  120_000,
);
