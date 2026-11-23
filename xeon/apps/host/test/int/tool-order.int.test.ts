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

// L1.tools.spec §3.3.1 [결정: 2026-11-19, 사용자, AGE-56 후속] (int, 실제 엔진): 승인본이 아직 켜지지 않은 상태에서 드래프트를 먼저 얹는 순서.
// 순서를 바꿔 가며 일반 대화의 승인본이 켜지고 그 도구가 도는지 본다.

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
      description: `Tool that writes ${tag} (test fixture).`,
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
import { defineOrchestration, orchestrationManifest } from "@fresnel/orchestration-sdk";
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

function turnsOf(count: number) {
  const steps = [];
  for (let index = 1; index <= count; index++) steps.push(tapeCall(index), tapeDone(index));
  return tapeBuildModels(
    tapeProvider(tapePlayer(tape("tool-order", steps), { clock: realTapeClock() })),
  );
}

async function waitEnabledOn(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
    const listed = await connection.request("ext.list", {});
    if (listed.extensions.find((entry) => entry.name === name)?.status === "enabled") return;
    // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(25);
  }
  throw new Error(`${name} did not become enabled`);
}

interface Rig {
  readonly home: ReturnType<typeof useEngineHome>;
  readonly workspace: string;
  readonly approvedMarker: string;
  readonly draftMarker: string;
  readonly draftFolder: string;
}

function setupRig(): Rig {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-tool-order-")));
  const approvedMarker = join(workspace, "approved.marker");
  const draftMarker = join(workspace, "draft.marker");
  writePluginFolder(userPluginRoot(home, PLUGIN), "APPROVED", approvedMarker);
  const draftFolder = join(workspace, "draft-folder");
  writePluginFolder(draftFolder, "DRAFT", draftMarker);
  return { home, workspace, approvedMarker, draftMarker, draftFolder };
}

async function approveAndProfile(
  connection: ReturnType<typeof createHostConnection>,
): Promise<void> {
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
}

interface Session {
  readonly host: Awaited<ReturnType<typeof startInProcessHost>>;
  readonly connection: ReturnType<typeof createHostConnection>;
  readonly collector: ReturnType<typeof collectEvents>;
  readonly runTurn: (threadId: ThreadId, input: string) => Promise<void>;
}

async function openSession(turns: number): Promise<Session> {
  const host = await startInProcessHost({
    devChecks: true,
    pluginHost: isolatedPluginHost(),
    buildModels: turnsOf(turns),
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
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });
  return { host, connection, collector, runTurn };
}

/** 드래프트 테스트 런 하나를 열어 도구를 부르게 하고 카드를 허용한다 */
async function runDraftTestRun(session: Session, draftId: string): Promise<void> {
  const withDraft = await session.connection.request("testRun.start", {
    baseProfileId: "work",
    drafts: [{ plugin: PLUGIN, draftId }],
  });
  const draftTurn = await startTurnWhenIdle(session.connection, {
    threadId: withDraft.threadId,
    input: "use it",
  });
  const asked = await session.collector.waitFor(
    (event) => event.kind === "approval.requested",
    60_000,
  );
  await session.connection.request("approval.respond", {
    approvalId: asked.id,
    decision: "allow",
  });
  await session.collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === draftTurn.turnId,
    60_000,
  );
}

realTest(
  "a draft test run opened first, with no conversation having opened the approved plugin, does not keep a normal conversation from enabling and running the approved tool",
  async () => {
    const rig = setupRig();
    const previousCwd = process.cwd();
    process.chdir(rig.workspace);
    const session = await openSession(2);
    try {
      await approveAndProfile(session.connection);
      const made = await session.connection.request("plugin.draft.create", {
        dir: rig.draftFolder,
      });
      await runDraftTestRun(session, made.draftId);
      expect([readMarker(rig.draftMarker), readMarker(rig.approvedMarker)]).toEqual([
        "DRAFT",
        null,
      ]);
      const normal = await session.connection.request("thread.create", {
        workspace: rig.workspace,
        profileId: "work",
      });
      await waitEnabledOn(session.connection, PLUGIN);
      await session.runTurn(normal.threadId, "use it");
      expect(readMarker(rig.approvedMarker)).toBe("APPROVED");
    } finally {
      await session.connection.close();
      await session.host.close();
      process.chdir(previousCwd);
      rmSync(rig.workspace, { recursive: true, force: true });
      rig.home.dispose();
    }
  },
  240_000,
);

realTest(
  "after the draft test run is closed, a normal conversation opened later enables the approved plugin and runs the approved tool",
  async () => {
    const rig = setupRig();
    const previousCwd = process.cwd();
    process.chdir(rig.workspace);
    const session = await openSession(2);
    try {
      await approveAndProfile(session.connection);
      const made = await session.connection.request("plugin.draft.create", {
        dir: rig.draftFolder,
      });
      const withDraft = await session.connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: PLUGIN, draftId: made.draftId }],
      });
      const draftTurn = await startTurnWhenIdle(session.connection, {
        threadId: withDraft.threadId,
        input: "use it",
      });
      const asked = await session.collector.waitFor(
        (event) => event.kind === "approval.requested",
        60_000,
      );
      await session.connection.request("approval.respond", {
        approvalId: asked.id,
        decision: "allow",
      });
      await session.collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === draftTurn.turnId,
        60_000,
      );
      await session.connection.request("thread.close", { threadId: withDraft.threadId });
      const normal = await session.connection.request("thread.create", {
        workspace: rig.workspace,
        profileId: "work",
      });
      await waitEnabledOn(session.connection, PLUGIN);
      await session.runTurn(normal.threadId, "use it");
      expect(readMarker(rig.approvedMarker)).toBe("APPROVED");
    } finally {
      await session.connection.close();
      await session.host.close();
      process.chdir(previousCwd);
      rmSync(rig.workspace, { recursive: true, force: true });
      rig.home.dispose();
    }
  },
  240_000,
);

realTest(
  "after an engine restart, a normal conversation enables the approved plugin and runs the approved tool even though a draft test run ran before the restart",
  async () => {
    const rig = setupRig();
    const previousCwd = process.cwd();
    process.chdir(rig.workspace);
    let session = await openSession(1);
    try {
      await approveAndProfile(session.connection);
      const made = await session.connection.request("plugin.draft.create", {
        dir: rig.draftFolder,
      });
      await runDraftTestRun(session, made.draftId);
      await session.connection.close();
      await session.host.close();
      session = await openSession(1);
      const normal = await session.connection.request("thread.create", {
        workspace: rig.workspace,
        profileId: "work",
      });
      await waitEnabledOn(session.connection, PLUGIN);
      await session.runTurn(normal.threadId, "use it");
      expect(readMarker(rig.approvedMarker)).toBe("APPROVED");
    } finally {
      await session.connection.close();
      await session.host.close();
      process.chdir(previousCwd);
      rmSync(rig.workspace, { recursive: true, force: true });
      rig.home.dispose();
    }
  },
  240_000,
);
