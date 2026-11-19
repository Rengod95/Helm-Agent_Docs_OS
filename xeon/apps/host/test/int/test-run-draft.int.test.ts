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
import { attemptAsync } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { internalDraftName } from "@fresnel/ext-host";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { callingModels } from "../fixtures/call-tape.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.8.1 (int, 실제 엔진): 초안을 쓰는 테스트 실행(`testRun.start { drafts }`).
// (a) 격리가 있으면 초안이 격리 프로세스에 실리고, 그 초안의 도구 호출은 `bypass` 대화에서도 승인 카드를 띄운다(`draft` 표지).
//     턴 기록은 `test` 범위이고 `testRun`이 기준 프로필, 묶음 id, 초안 버전을 싣는다. 재시작 뒤 같은 홈에서 다시 열면 초안이 되살아난다.
// (b) 격리가 없으면(`pluginHost.disabled`) `overlay.draftUnavailable`로 거절하고, 대화를 만들지 않는다.
// 실제 격리가 이 샌드박스에서 서지 못하면 `realEngineGate`가 시험을 건너뛴다(덧씌우기 초안 시험과 같은 게이트).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const DRAFT = "draft-probe";
const TOOL = "draftprobe_tick";

/** 초안 폴더. 도구 하나를 그룹 SDK로 등록하고 실행하면 표지 파일을 쓴다(overlay-draft 시험과 같은 모양) */
function writeDraftFolder(root: string, marker: string): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: DRAFT,
      version: "1.0.0",
      purpose: "Draft tool for the test run draft test",
      defaultEnabled: false,
      entry: "./src/index.ts",
      group: {},
      plugins: [{ layer: "L3", hooks: [], requires: [], optional: [] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
import { Type } from "typebox";
import { defineGroup, groupManifest } from "@fresnel/group-sdk";
export const extension = (ctx) => {
  const group = defineGroup({
    manifest: groupManifest({
      schemaVersion: 2,
      name: ctx.manifest.name,
      version: "1.0.0",
      entry: "./src/index.ts",
      group: {},
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

/**
 * 기준 프로필 `work`를 저장한다. 공장 기본은 이 시험 집에 없는 `helm`을 들어 검증에서 오류가 나므로 쓰지 않는다
 * (`test-run-start.int.test.ts`와 같다)
 */
async function storeBaseProfile(
  connection: ReturnType<typeof createHostConnection>,
): Promise<void> {
  await connection.request("profile.put", {
    profile: {
      id: "work",
      title: "Work",
      plugins: [{ name: "cap-workspace" }],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
}

/** 확장 목록에서 그 이름의 항목이 켜질 때까지 기다려 돌려준다. 켜지지 않으면 마지막 값을 준다(시험이 비교로 실패하게 한다) */
async function enabledEntry(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
): Promise<ExtListEntry | undefined> {
  let entry: ExtListEntry | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
    const listed = await connection.request("ext.list", {});
    entry = listed.extensions.find((item) => item.name === name);
    if (entry?.status === "enabled") return entry;
    // oxlint-disable-next-line no-await-in-loop -- 켜짐을 기다리는 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(25);
  }
  return entry;
}

/** 격리 호스트의 시작 옵션. 도구를 한 번 부르고 끝나는 모형 응답을 쓴다 */
function isolatedOptions(label: string) {
  return {
    devChecks: true,
    pluginHost: isolatedPluginHost(),
    buildModels: callingModels(label, [{ name: TOOL, args: {} }], "done."),
  };
}

/** 도구를 한 번 부르고 끝나는 턴을 `turns`번 잇달아 하는 모형 응답 */
function repeatingModels(label: string, turns: number): ReturnType<typeof callingModels> {
  const entries = Array.from({ length: turns }, (_, index) => [
    {
      role: "main" as const,
      label: `call ${String(index + 1)}`,
      response: {
        type: "message" as const,
        content: [t.toolCall(TOOL, {}, `call_${String(index + 1)}`)],
        stopReason: "toolUse" as const,
      },
    },
    {
      role: "main" as const,
      label: `done ${String(index + 1)}`,
      response: {
        type: "message" as const,
        content: [t.text("done.")],
        stopReason: "stop" as const,
      },
    },
  ]).flat();
  return tapeBuildModels(
    tapeProvider(tapePlayer(tape(label, entries), { clock: realTapeClock() })),
  );
}

/** 초안을 만들고 목록에서 식별자와 내용 해시를 읽는다. 검토하지 않는다 */
async function createDraft(
  connection: ReturnType<typeof createHostConnection>,
  folder: string,
): Promise<{ readonly draftId: string; readonly contentHash: string }> {
  const made = await connection.request("plugin.draft.create", { dir: folder });
  const listed = await connection.request("plugin.draft.list", { name: DRAFT });
  const found = listed.drafts.find((draft) => draft.draftId === made.draftId);
  if (found === undefined) throw new Error("the draft is not listed after it was created");
  return { draftId: made.draftId, contentHash: found.contentHash };
}

realTest(
  "a draft test run under the real isolated host: the draft tool asks with a draft mark in bypass, the record is test scope with the draft version, and the draft is restored after a restart",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-test-run-draft-")));
    const marker = join(workspace, "tool.marker");
    const folder = join(workspace, "draft-folder");
    writeDraftFolder(folder, marker);
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const first = await startInProcessHost(isolatedOptions("test-run-draft"));
    const connection = createHostConnection(first.client);
    const collector = collectEvents(connection);
    let threadId: ThreadId | undefined;
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await storeBaseProfile(connection);
      const draft = await createDraft(connection, folder);
      const internal = internalDraftName(DRAFT, draft.draftId);
      const versionId = `draft:${draft.draftId}:${draft.contentHash.slice("sha256:".length, "sha256:".length + 8)}`;
      const started = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: DRAFT, draftId: draft.draftId }],
        runGroupId: "grp-draft",
      });
      threadId = started.threadId;
      // 결과의 초안 줄은 이름, 초안 id, 판 식별자다
      expect(started).toEqual({
        threadId: expect.any(String),
        profileId: "work",
        drafts: [{ plugin: DRAFT, draftId: draft.draftId, versionId }],
        runGroupId: "grp-draft",
        skippedPlugins: [],
      });
      // 대화를 여는 때 기록된 시작 적용이 초안의 내부 이름을 싣는다(§4.8.1 2)
      const opened = await collector.waitFor(
        (event) =>
          event.kind === "profile.applied" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "open",
        60_000,
      );
      expect(opened.payload).toMatchObject({ added: expect.arrayContaining([internal]) });
      const before = await enabledEntry(connection, internal);
      expect(before).toMatchObject({ name: internal, status: "enabled" });

      // 초안 출신 호출은 bypass에서도 승인 카드를 띄운다. 카드는 초안 표지를 싣는다
      const turn = await startTurnWhenIdle(connection, { threadId, input: "use it" });
      const asked = await collector.waitFor((event) => event.kind === "approval.requested", 60_000);
      expect(asked.payload).toMatchObject({
        body: {
          kind: "tool",
          tool: { toolName: TOOL, draft: { plugin: DRAFT, draftId: draft.draftId } },
        },
      });
      expect(existsSync(marker)).toBe(false);
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === turn.turnId,
        60_000,
      );
      expect(existsSync(marker) ? readFileSync(marker, "utf8") : null).toBe("ran");

      // 기록: 테스트 범위이고 구성 전체를 싣는다. 덧씌우기는 없다(`overlay`는 null)
      const read = await connection.request("turnRecord.get", { threadId, turnId: turn.turnId });
      expect(read.record).toMatchObject({
        scope: "test",
        overlay: null,
        testRun: {
          runGroupId: "grp-draft",
          baseProfileId: "work",
          drafts: [{ plugin: DRAFT, draftId: draft.draftId, versionId }],
        },
      });
      await connection.close();
      await first.close();

      // 재시작: 같은 홈에서 다시 열면 초안이 다시 실리고, 같은 확장 항목이 보인다(§4.8.1 3)
      const second = await startInProcessHost(isolatedOptions("test-run-draft"));
      const again = createHostConnection(second.client);
      try {
        await again.request("host.hello", HELLO_PARAMS);
        await again.request("events.subscribe", { from: "head" });
        await again.request("thread.open", { threadId, mode: "write" });
        const after = await enabledEntry(again, internal);
        expect(after).toEqual(before);
        // 기록의 구성은 재시작 뒤에도 같다
        const listed = await again.request("turnRecord.list", { threadId, scope: ["test"] });
        expect(listed.items.map((item) => item.turnId)).toEqual([turn.turnId]);
      } finally {
        await again.close();
        await second.close();
      }
    } finally {
      // 이미 닫은 것은 다시 닫아도 되는 값으로 바꾼다(정리 중 실패가 원래 실패를 가리지 않게 한다)
      await attemptAsync(() => connection.close());
      await attemptAsync(() => first.close());
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  180_000,
);

/** 확장 목록에서 그 이름이 사라질 때까지 기다린다. 사라지면 true다 */
async function gone(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- 내려감을 기다리는 폴링 (eng.testing.guide TS-05)
    const listed = await connection.request("ext.list", {});
    if (!listed.extensions.some((entry) => entry.name === name)) return true;
    // oxlint-disable-next-line no-await-in-loop -- 내려감을 기다리는 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(25);
  }
  return false;
}

realTest(
  "two versions of one plugin draft run as separate test runs: B starts while A is open and after A is closed, each version runs its own code, and the internal names differ",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-test-run-draft-two-")));
    const markers = ["a", "b", "c"].map((label) => join(workspace, `tool-${label}.marker`));
    const folders = ["a", "b", "c"].map((label) => join(workspace, `draft-${label}`));
    markers.forEach((marker, index) => {
      const folder = folders[index];
      if (folder !== undefined) writeDraftFolder(folder, marker);
    });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      ...isolatedOptions("test-run-draft-two"),
      buildModels: repeatingModels("test-run-draft-two", 2),
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await storeBaseProfile(connection);
      const [folderA, folderB, folderC] = folders;
      const [markerA, markerB, markerC] = markers;
      if (
        folderA === undefined ||
        folderB === undefined ||
        folderC === undefined ||
        markerA === undefined ||
        markerB === undefined ||
        markerC === undefined
      ) {
        throw new Error("fixture folders are missing");
      }
      // 판 셋을 잇달아 만든다(식별자의 앞쪽이 같은 때)
      const draftA = await createDraft(connection, folderA);
      const draftB = await createDraft(connection, folderB);
      const draftC = await createDraft(connection, folderC);
      const nameA = internalDraftName(DRAFT, draftA.draftId);
      const nameB = internalDraftName(DRAFT, draftB.draftId);
      const nameC = internalDraftName(DRAFT, draftC.draftId);
      expect(new Set([nameA, nameB, nameC]).size).toBe(3);

      // A가 열려 있는 동안 B를 시작한다: 둘이 동시에 실려 있다
      const runA = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: DRAFT, draftId: draftA.draftId }],
      });
      const runB = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: DRAFT, draftId: draftB.draftId }],
      });
      expect(await enabledEntry(connection, nameA)).toMatchObject({ status: "enabled" });
      expect(await enabledEntry(connection, nameB)).toMatchObject({ status: "enabled" });

      // 각 판은 자기 코드로 돈다: B의 대화는 B의 표지만 쓴다
      const turnB = await startTurnWhenIdle(connection, {
        threadId: runB.threadId,
        input: "use b",
      });
      const askedB = await collector.waitFor(
        (event) => event.kind === "approval.requested" && event.turnId === turnB.turnId,
        60_000,
      );
      await connection.request("approval.respond", { approvalId: askedB.id, decision: "allow" });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === turnB.turnId,
        60_000,
      );
      expect(existsSync(markerB) ? readFileSync(markerB, "utf8") : null).toBe("ran");
      expect(existsSync(markerA)).toBe(false);
      const turnA = await startTurnWhenIdle(connection, {
        threadId: runA.threadId,
        input: "use a",
      });
      const askedA = await collector.waitFor(
        (event) => event.kind === "approval.requested" && event.turnId === turnA.turnId,
        60_000,
      );
      await connection.request("approval.respond", { approvalId: askedA.id, decision: "allow" });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === turnA.turnId,
        60_000,
      );
      expect(existsSync(markerA) ? readFileSync(markerA, "utf8") : null).toBe("ran");
      expect(existsSync(markerC)).toBe(false);

      // 둘을 닫으면 둘 다 내려가고, 다음 판 C를 호스트 재시작 없이 시험한다
      // (같은 엔진 안에서는 연결이 닫혀도 임대를 놓지 않으므로, 서비스 엔진이 대화를 놓을 때 부르는 `forget`을 직접 부른다)
      host.engine.ports.m4.pluginSet.forget(runA.threadId);
      host.engine.ports.m4.pluginSet.forget(runB.threadId);
      expect(await gone(connection, nameA)).toBe(true);
      expect(await gone(connection, nameB)).toBe(true);
      const runC = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: DRAFT, draftId: draftC.draftId }],
      });
      expect(runC.drafts).toEqual([
        {
          plugin: DRAFT,
          draftId: draftC.draftId,
          versionId: expect.stringContaining(draftC.draftId),
        },
      ]);
      expect(await enabledEntry(connection, nameC)).toMatchObject({ status: "enabled" });
      // 일반 대화의 도구 목록에는 드래프트의 이름이 없다
      const listed = await connection.request("ext.list", {});
      expect(listed.extensions.some((entry) => entry.name === nameA)).toBe(false);
    } finally {
      await attemptAsync(() => connection.close());
      await attemptAsync(() => host.close());
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  240_000,
);

realTest(
  "a draft test run whose draft was discarded while the engine was down reopens without that draft: the thread opens, the draft is not loaded, and the set does not name it",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-test-run-draft-gone-")));
    const folder = join(workspace, "draft-folder");
    writeDraftFolder(folder, join(workspace, "tool.marker"));
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const first = await startInProcessHost(isolatedOptions("test-run-draft-gone"));
    const connection = createHostConnection(first.client);
    let threadId: ThreadId | undefined;
    let draftId = "";
    let groupId = "";
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await storeBaseProfile(connection);
      const draft = await createDraft(connection, folder);
      draftId = draft.draftId;
      const started = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [{ plugin: DRAFT, draftId }],
      });
      threadId = started.threadId;
      groupId = started.runGroupId;
    } finally {
      await connection.close();
      await first.close();
    }
    // 엔진이 내려간 사이 초안을 버린다
    const second = await startInProcessHost(isolatedOptions("test-run-draft-gone"));
    const again = createHostConnection(second.client);
    try {
      await again.request("host.hello", HELLO_PARAMS);
      await again.request("events.subscribe", { from: "head" });
      await again.request("plugin.draft.discard", { draftId });
      // 열 때 초안을 되살리지 못한다. 대화는 초안 없이 열리고, 시작 적용의 집합에도 초안 이름이 없다(§4.8.1 3)
      const collector = collectEvents(again);
      await again.request("thread.open", { threadId, mode: "write" });
      const opened = await collector.waitFor(
        (event) =>
          event.kind === "profile.applied" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "reason" in event.payload &&
          event.payload.reason === "open",
        60_000,
      );
      expect(opened.payload).toMatchObject({
        profileId: "work",
        added: expect.not.arrayContaining([internalDraftName(DRAFT, draftId)]),
      });
      const listed = await again.request("ext.list", {});
      expect(
        listed.extensions.some((entry) => entry.name === internalDraftName(DRAFT, draftId)),
      ).toBe(false);
      // 표지도 실제로 돈 구성을 싣는다: 초안이 없는 테스트 실행으로 읽힌다
      expect(
        (await again.request("thread.list", {})).threads.map((thread) => thread.testRun),
      ).toEqual([{ profileId: "work", target: null, paused: false, runGroupId: groupId }]);
    } finally {
      await again.close();
      await second.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  120_000,
);

realTest(
  "with no isolated plugin host a draft test run is refused with overlay.draftUnavailable, and no thread is created",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-test-run-draft-no-")));
    const folder = join(workspace, "draft-folder");
    writeDraftFolder(folder, join(workspace, "tool.marker"));
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: callingModels("test-run-draft-none", [{ name: TOOL, args: {} }], "done."),
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await storeBaseProfile(connection);
      const draft = await createDraft(connection, folder);
      const before = (await connection.request("thread.list", {})).threads.length;
      const refused = await rejectionOf(
        connection.request("testRun.start", {
          baseProfileId: "work",
          drafts: [{ plugin: DRAFT, draftId: draft.draftId }],
        }),
      );
      expect(refused).toMatchObject({ data: { kind: "overlay.draftUnavailable" } });
      // 대화는 하나도 늘지 않고, 초안은 어디에도 실리지 않는다
      expect((await connection.request("thread.list", {})).threads.length).toBe(before);
      const listed = await connection.request("ext.list", {});
      expect(
        listed.extensions.some((entry) => entry.name === internalDraftName(DRAFT, draft.draftId)),
      ).toBe(false);
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
