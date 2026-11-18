import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { AssembleOptions } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import {
  readProfilesText,
  storedProfilesOf,
  writeMarkerPlugin,
} from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  until,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// M5c §4.7.3, §8 수용 31·30 (int, 실제 엔진): 검토함의 승인이 프로필에 쓰는 일과, 승인이 쓰는 것이 승인 카드를 띄우지 않는다는 것.
// (1) 새 플러그인을 프로필에 넣고 승인하면 그 프로필이 맨 뒤에 넣은 채로 저장되고(rev 증가), `profile.changed`가 오고, 그 프로필의 열린 대화가 다음 턴에 싣는다.
// (2) 제거 요청은 승인 전까지 계속 돌고, 승인하면 모든 프로필과 공통 묶음에서 이름이 빠지며 대화가 더 싣지 않는다.
// (3) `libraryOnly` 승인은 프로필 파일을 바꾸지 않는다.
// (4) 검토함이 적용하는 승인(새 플러그인, 제거)은 `approval.requested`를 만들지 않는다. 같은 대화에서 도구 호출이 만드는 승인은 만든다(대조).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const ADD = "live-add";
const BASE = "cap-knowledge";
const PROFILE_A = "decide-a";
const PROFILE_B = "decide-b";

type Connection = ReturnType<typeof createHostConnection>;

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function bodyKindOf(event: EventWire): string {
  const kind = recordOf(recordOf(event.payload)["body"])["kind"];
  return typeof kind === "string" ? kind : "";
}

async function runTurn(
  connection: Connection,
  collector: EventCollector,
  threadId: ThreadId,
  input: string,
): Promise<void> {
  const started = await startTurnWhenIdle(connection, { threadId, input });
  await collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
}

/** 훅이 쓴 표지 글을 읽는다. `boundary.settle.after`는 `turn.completed` 뒤에 정산되므로 표지가 생길 때까지 기다린다 */
async function markerAfter(marker: string): Promise<string> {
  if (!(await until(() => existsSync(marker), 10_000))) {
    throw new Error(`the hook did not write ${marker}`);
  }
  return readFileSync(marker, "utf8");
}

/** 검토함을 훑고 그 이름의 대기 항목 id를 돌려준다. 새 플러그인이어야 한다 */
async function scanForNew(connection: Connection, name: string): Promise<string> {
  await connection.request("plugin.scan", {});
  const listed = await connection.request("pluginReview.list", { state: "pending" });
  const item = listed.items.find((entry) => entry.name === name);
  if (item === undefined) throw new Error(`the review inbox has no item for ${name}`);
  expect(item.kind).toBe("new");
  return item.itemId;
}

/** 실제 엔진을 시작한다. 기본 그룹은 끄지 않는다(끄면 외부 확장을 싣지 않는다). 격리 샌드박스는 이 기기에서 시험할 수 없어 엔진 안에서 돈다 */
function startHost(buildModels: NonNullable<AssembleOptions["buildModels"]>) {
  return startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    buildModels,
  });
}

realTest(
  "approving a new plugin into a profile writes that profile with the plugin last and a bumped rev, announces profile.changed, and an open idle thread on it runs the plugin at its next turn",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-decide-add-")));
    const marker = join(workspace, "add.marker");
    writeMarkerPlugin(home, ADD, "ADD-1", marker);
    const model = recordingModels("decide-add", ["one.", "two."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model.buildModels);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      await connection.request("profile.put", {
        profile: {
          id: PROFILE_A,
          title: "A",
          plugins: [{ name: BASE }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const before = storedProfilesOf(home);
      const beforeA = before.profiles.find((profile) => profile.id === PROFILE_A);
      const created = await connection.request("thread.create", {
        workspace,
        profileId: PROFILE_A,
      });

      const itemId = await scanForNew(connection, ADD);
      const changed = new Promise<{
        readonly ids: readonly string[];
        readonly commonChanged: boolean;
      }>((resolve) => {
        connection.onNotification("profile.changed", (params) => {
          resolve({ ids: params.ids, commonChanged: params.commonChanged });
        });
      });
      const decided = await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [PROFILE_A], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual([PROFILE_A]);

      // 저장된 프로필: 맨 뒤에 넣고 rev를 하나 올린다. 공통 묶음은 그대로다
      const after = storedProfilesOf(home);
      const afterA = after.profiles.find((profile) => profile.id === PROFILE_A);
      expect(afterA?.plugins).toEqual([{ name: BASE }, { name: ADD }]);
      expect(afterA?.rev).toBe((beforeA?.rev ?? -1) + 1);
      expect(after.common).toEqual(before.common);
      expect(await changed).toEqual({ ids: [PROFILE_A], commonChanged: false });

      // 그 프로필의 열린 대화는 다음 턴에 플러그인을 싣고, 집합 변화를 기록에 남긴다
      await runTurn(connection, collector, created.threadId, "first");
      expect(await markerAfter(marker)).toBe("ADD-1");
      const onThread = await connection.request("ext.list", { threadId: created.threadId });
      const entry = onThread.extensions.find((item) => item.name === ADD);
      expect(entry?.plugins.map((plugin) => plugin.enabledSource)).toEqual(["profile"]);
      const added = collector.events
        .filter((event) => event.kind === "profile.applied")
        .map((event) => recordOf(event.payload))
        .filter((payload) => payload["profileId"] === PROFILE_A);
      expect(added.map((payload) => payload["added"])).toContainEqual([ADD]);
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

realTest(
  "a removal request keeps the plugin running until approved; approving it takes the name out of every profile and the common set, and the thread stops running it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-decide-remove-")));
    const marker = join(workspace, "remove.marker");
    writeMarkerPlugin(home, ADD, "ADD-1", marker);
    const model = recordingModels("decide-remove", ["one.", "two."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model.buildModels);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      // 설정: 새 플러그인을 보관으로 승인하고, 두 프로필과 공통 묶음에 넣는다
      const itemId = await scanForNew(connection, ADD);
      await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      await connection.request("profile.put", {
        profile: {
          id: PROFILE_A,
          title: "A",
          plugins: [{ name: BASE }, { name: ADD }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      await connection.request("profile.put", {
        profile: {
          id: PROFILE_B,
          title: "B",
          plugins: [{ name: ADD }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      await connection.request("profile.common.put", {
        common: { plugins: [{ name: ADD }], settings: [] },
        baseRev: 0,
      });
      const created = await connection.request("thread.create", {
        workspace,
        profileId: PROFILE_A,
      });
      await runTurn(connection, collector, created.threadId, "before");
      expect(await markerAfter(marker)).toBe("ADD-1");
      rmSync(marker, { force: true });

      // 제거를 요청하면 제거 항목이 생기고, 승인 전까지 플러그인은 계속 돈다
      const requested = await connection.request("plugin.requestRemove", { name: ADD });
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      const removal = pending.items.find((item) => item.itemId === requested.itemId);
      expect([removal?.kind, removal?.state]).toEqual(["remove", "pending"]);
      await runTurn(connection, collector, created.threadId, "while pending");
      expect(await markerAfter(marker)).toBe("ADD-1");

      // 승인하면 두 프로필과 공통 묶음에서 이름이 빠진다
      const decided = await connection.request("pluginReview.decide", {
        itemId: requested.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      const stored = storedProfilesOf(home);
      expect(stored.profiles.find((profile) => profile.id === PROFILE_A)?.plugins).toEqual([
        { name: BASE },
      ]);
      expect(stored.profiles.find((profile) => profile.id === PROFILE_B)?.plugins).toEqual([]);
      expect(stored.common.plugins).toEqual([]);

      // 대화는 더 싣지 않는다: 그 대화의 목록에서 상태가 꺼짐이고 켜짐 출처가 없다(훅은 남은 기록이라 꺼진 채 있다)
      await runTurn(connection, collector, created.threadId, "after removal");
      const onThread = await connection.request("ext.list", { threadId: created.threadId });
      const entry = onThread.extensions.find((item) => item.name === ADD);
      expect(entry?.status).toBe("disabled");
      expect(entry?.plugins.map((plugin) => plugin.enabledSource)).toEqual(["none"]);
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

realTest(
  "approving with libraryOnly writes no profile: the profile file keeps the same bytes, and a thread on that profile does not run the plugin",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-decide-lib-")));
    const marker = join(workspace, "lib.marker");
    writeMarkerPlugin(home, ADD, "ADD-1", marker);
    const model = recordingModels("decide-lib", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model.buildModels);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("profile.put", {
        profile: {
          id: PROFILE_A,
          title: "A",
          plugins: [{ name: BASE }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const bytesBefore = readProfilesText(home);
      const itemId = await scanForNew(connection, ADD);
      const decided = await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [PROFILE_A], libraryOnly: true },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual([]);
      expect(readProfilesText(home)).toBe(bytesBefore);

      // 라이브러리에는 있지만 그 프로필의 대화는 싣지 않는다
      const created = await connection.request("thread.create", {
        workspace,
        profileId: PROFILE_A,
      });
      const onThread = await connection.request("ext.list", { threadId: created.threadId });
      const entry = onThread.extensions.find((item) => item.name === ADD);
      expect(entry?.plugins.map((plugin) => plugin.enabledSource) ?? []).not.toContain("profile");
      const library = await connection.request("ext.list", {});
      expect(library.extensions.find((item) => item.name === ADD)?.origin).toBe("user");
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

realTest(
  "approving a new plugin and a removal raises no approval request, while a tool call on the same kind of thread does (control)",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-decide-approval-")));
    const marker = join(workspace, "approval.marker");
    writeMarkerPlugin(home, ADD, "ADD-1", marker);
    // 대조: 같은 대화에서 `bash` 도구 호출은 기본 모드에서 승인을 만든다. 승인 요청에는 허용으로 답한다
    const call: JsonObject = { command: "echo control" };
    const player = tapePlayer(
      tape("decide-approval", [
        {
          role: "main" as const,
          label: "control call",
          response: {
            type: "message" as const,
            content: [t.toolCall("bash", call, "call_control")],
            stopReason: "toolUse" as const,
          },
        },
        {
          role: "main" as const,
          label: "done",
          response: {
            type: "message" as const,
            content: [t.text("done.")],
            stopReason: "stop" as const,
          },
        },
      ]),
      { clock: realTapeClock() },
    );
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(tapeBuildModels(tapeProvider(player)));
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      const itemId = await scanForNew(connection, ADD);
      const mark = collector.events.length;
      await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      const removal = await connection.request("plugin.requestRemove", { name: ADD });
      await connection.request("pluginReview.decide", {
        itemId: removal.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: false },
      });
      // 응답 뒤에 승인 요청이 있었다면 같은 연결의 알림으로 이미 왔다
      const duringDecisions = collector.events
        .slice(mark)
        .filter((event) => event.kind === "approval.requested");
      expect(duringDecisions).toEqual([]);

      // 대조: 같은 방식으로 도구 호출을 하면 승인 요청이 온다
      const created = await connection.request("thread.create", { workspace });
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run the control",
      });
      const asked = await collector.waitFor(
        (event) => event.kind === "approval.requested" && event.turnId === started.turnId,
      );
      expect(bodyKindOf(asked)).toBe("tool");
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
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
