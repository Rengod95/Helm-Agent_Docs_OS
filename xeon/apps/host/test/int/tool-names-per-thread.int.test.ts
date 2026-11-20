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
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { userPluginRoot } from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// L1.tools.spec §3.3.1, X.operations.spec §4.5.1 [결정: 2026-11-19, 사용자, AGE-56] (int, 실제 엔진): 도구 이름은 대화마다 정한다.
// 승인본과 드래프트가 같은 플러그인 이름 `draft-probe`로 같은 도구 이름을 요청하고, 둘이 함께 엔진에 실려 있다.
// (a) 드래프트를 얹은 테스트 런은 그 이름을 부르면 드래프트가 돈다(승인 카드에 드래프트 표지). (b) 일반 대화는 같은 이름을 부르면 승인본이 돈다
// (드래프트가 실려 있어도 승인본의 이름이 정식 이름으로 바뀌지 않는다). (c) 드래프트 없는 다른 테스트 런도 승인본이 돈다.
// 어느 판이 돌았는지는 표지 파일의 글로 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const PLUGIN = "draft-probe";
const TOOL = "draftprobe_tick";

function readMarker(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** 도구 하나를 등록하고 실행하면 `marker`에 `tag`를 쓰는 플러그인 폴더(그룹 SDK) */
function writePluginFolder(root: string, tag: string, marker: string): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: PLUGIN,
      version: "1.0.0",
      purpose: `Tool that writes ${tag}`,
      defaultEnabled: false,
      entry: "./src/index.ts",
      orchestration: {},
      plugins: [{ layer: "L3", hooks: [], requires: [], optional: [] }],
    }),
  );
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
        description: "Write the tag when run",
        parameters: Type.Object({}),
        replay: "safe",
        execute: () => {
          writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(tag)});
          return Promise.resolve(${JSON.stringify(tag)});
        },
      });
    },
  });
  return group.entry(ctx);
};
`,
  );
}

function tapeCall(index: number) {
  return {
    role: "main" as const,
    label: `call ${String(index)}`,
    response: {
      type: "message" as const,
      content: [t.toolCall(TOOL, {}, `call_${String(index)}`)],
      stopReason: "toolUse" as const,
    },
  };
}

function tapeDone(index: number) {
  return {
    role: "main" as const,
    label: `done ${String(index)}`,
    response: {
      type: "message" as const,
      content: [t.text("done.")],
      stopReason: "stop" as const,
    },
  };
}

/** 세 번의 턴에서 같은 도구를 한 번씩 부르고 한 마디로 끝낸다(턴마다 호출 하나, 답 하나) */
function threeTurns() {
  const steps = [tapeCall(1), tapeDone(1), tapeCall(2), tapeDone(2), tapeCall(3), tapeDone(3)];
  return tapeBuildModels(
    tapeProvider(tapePlayer(tape("tool-names-per-thread", steps), { clock: realTapeClock() })),
  );
}

realTest(
  "with an approved plugin and a draft of the same plugin both loaded, the same tool name runs the draft in the draft test run and the approved tool in a normal conversation and in another test run",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-tool-names-")));
    const approvedMarker = join(workspace, "approved.marker");
    const draftMarker = join(workspace, "draft.marker");
    writePluginFolder(userPluginRoot(home, PLUGIN), "APPROVED", approvedMarker);
    const draftFolder = join(workspace, "draft-folder");
    writePluginFolder(draftFolder, "DRAFT", draftMarker);
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: isolatedPluginHost(),
      buildModels: threeTurns(),
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    const runTurn = async (threadId: ThreadId, input: string): Promise<void> => {
      const started = await startTurnWhenIdle(connection, { threadId, input });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        60_000,
      );
    };
    // 대화를 만들면 프로필의 승인본이 켜진다. 켜질 때까지 기다린다(기한 있음)
    const waitEnabled = async (name: string): Promise<void> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
        const listed = await connection.request("ext.list", {});
        if (listed.extensions.find((entry) => entry.name === name)?.status === "enabled") return;
        // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
        await Bun.sleep(25);
      }
      throw new Error(`${name} did not become enabled`);
    };
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      // 승인본: 검토해 보관으로 승인한 뒤 프로필에 넣는다
      await connection.request("plugin.scan", {});
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      const item = pending.items.find((candidate) => candidate.name === PLUGIN);
      if (item === undefined) throw new Error("the review inbox has no item for the plugin");
      await connection.request("pluginReview.decide", {
        itemId: item.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      await connection.request("profile.put", {
        profile: {
          id: "work",
          title: "Work",
          plugins: [{ name: "cap-workspace" }, { name: PLUGIN }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const made = await connection.request("plugin.draft.create", { dir: draftFolder });

      // 일반 대화를 먼저 연다: 승인본이 켜진다. 그 뒤에 드래프트가 같은 엔진에 실린다
      const normal = await connection.request("thread.create", { workspace, profileId: "work" });
      await waitEnabled(PLUGIN);

      // (a) 드래프트를 얹은 테스트 런: 같은 이름을 부르면 드래프트가 돈다. 카드는 실제 이름과 드래프트 표지를 싣는다
      const withDraft = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: PLUGIN, draftId: made.draftId }],
      });
      const draftTurn = await startTurnWhenIdle(connection, {
        threadId: withDraft.threadId,
        input: "use it",
      });
      const asked = await collector.waitFor((event) => event.kind === "approval.requested", 60_000);
      expect(asked.payload).toMatchObject({
        body: {
          kind: "tool",
          tool: { toolName: TOOL, draft: { plugin: PLUGIN, draftId: made.draftId } },
        },
      });
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === draftTurn.turnId,
        60_000,
      );
      expect([readMarker(draftMarker), readMarker(approvedMarker)]).toEqual(["DRAFT", null]);

      // (b) 같은 엔진의 일반 대화(승인본만 프로필에 있다): 드래프트가 실려 있어도 같은 이름이 승인본을 돌린다
      await runTurn(normal.threadId, "use it");
      expect([readMarker(approvedMarker), readMarker(draftMarker)]).toEqual(["APPROVED", "DRAFT"]);
      rmSync(approvedMarker, { force: true });

      // (c) 드래프트 없는 다른 테스트 런: 승인본이 돈다
      const other = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [],
      });
      await runTurn(other.threadId, "use it");
      expect(readMarker(approvedMarker)).toBe("APPROVED");
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  240_000,
);
