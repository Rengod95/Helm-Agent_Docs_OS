import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { writeMarkerPlugin, writeMarkerPluginAt } from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  until,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// enRv(리뷰 화면이 쓰는 길, 실제 엔진): 설치(초안 → 제출 → 승인)가 승인과 함께 프로필에 넣는 일과 그 프로필의 대화가 플러그인의 훅을 도는 일이
// 엔진을 다시 시작하지 않고 된다. 승인하지 않은 판은 프로필에 못 들고, 거절한 것은 들어가지 않으며, 승인 뒤 원본이 바뀌어도 프로필은 승인한 판을 돌린다.
// 표지 파일(`marker`)의 글로 어느 판이 돌았는지 본다. 훅은 `turn.completed` 뒤에 정산되므로 표지를 기다려 읽는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "install-kit";
const PROFILE = "install-profile";
const BASE = "cap-knowledge";

type Connection = ReturnType<typeof createHostConnection>;

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

async function markerAfter(marker: string): Promise<string> {
  if (!(await until(() => existsSync(marker), 10_000))) {
    throw new Error(`the hook did not write ${marker}`);
  }
  return readFileSync(marker, "utf8");
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 이슈 코드만 값으로 비교한다(`profile.invalid`의 `details.issues`) */
function issueCodesOf(error: WireError): readonly string[] {
  const issues: unknown = recordOf(error.data.details)["issues"];
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: unknown) => {
    const code = recordOf(issue)["code"];
    return typeof code === "string" ? code : "";
  });
}

function startHost(model: ReturnType<typeof recordingModels>) {
  return startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "install-bundles-")),
    extraPlugins: [],
    buildModels: model.buildModels,
  });
}

/** 설치 화면과 같은 길: 폴더로 초안을 만들고 검토함에 제출한다. 항목 id를 돌려준다 */
async function install(connection: Connection, dir: string): Promise<string> {
  const draft = await connection.request("plugin.draft.create", { dir });
  const submitted = await connection.request("pluginReview.submitDraft", {
    draftId: draft.draftId,
  });
  return submitted.itemId;
}

function profileBody(id: string, plugins: readonly string[]) {
  return {
    id,
    title: id,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
  };
}

realTest(
  "a plugin installed from a folder is approved into a profile without a restart: a thread opened before runs it at its next turn, and a new thread on that profile runs its hook",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-install-")));
    const marker = join(workspace, "install.marker");
    const source = join(workspace, "source", NAME);
    writeMarkerPluginAt(source, NAME, "INSTALL-1", marker);
    const model = recordingModels("install", ["one.", "two."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE]),
        baseRev: null,
      });
      const early = await connection.request("thread.create", { workspace, profileId: PROFILE });

      const itemId = await install(connection, source);
      const pending = await connection.request("pluginReview.get", { itemId });
      expect([pending.item.kind, pending.item.state]).toEqual(["new", "pending"]);

      const decided = await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [PROFILE], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual([PROFILE]);
      const stored = await connection.request("profile.get", { id: PROFILE });
      expect(stored.profile.plugins).toEqual([{ name: BASE }, { name: NAME }]);

      // 승인했을 때 이미 열려 있던 대화는 다음 턴에 싣는다(다음 경계)
      await runTurn(connection, collector, early.threadId, "first");
      expect(await markerAfter(marker)).toBe("INSTALL-1");
      rmSync(marker, { force: true });

      // 승인 뒤에 새로 연 대화는 열 때부터 가진다
      const fresh = await connection.request("thread.create", { workspace, profileId: PROFILE });
      await runTurn(connection, collector, fresh.threadId, "second");
      expect(await markerAfter(marker)).toBe("INSTALL-1");
      const onThread = await connection.request("ext.list", { threadId: fresh.threadId });
      expect(
        onThread.extensions
          .find((entry) => entry.name === NAME)
          ?.plugins.map((p) => p.enabledSource),
      ).toEqual(["profile"]);
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
  "a version that is not approved cannot be put in a profile, a discarded one does not get in, and an edit of the source after approval goes back to review while the profile keeps running the approved version",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-install-neg-")));
    const marker = join(workspace, "neg.marker");
    writeMarkerPlugin(home, NAME, "APPROVED-1", marker);
    const other = join(workspace, "source", "discarded-kit");
    writeMarkerPluginAt(other, "discarded-kit", "DISCARDED", marker);
    const model = recordingModels("install-neg", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      // 1. 검토 대기뿐인 이름은 프로필에 못 든다
      await connection.request("plugin.scan", {});
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      const pendingItem = listed.items.find((entry) => entry.name === NAME);
      if (pendingItem === undefined) throw new Error("the inbox has no item for the kit");
      const notReviewed = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody(PROFILE, [NAME]),
          baseRev: null,
        }),
      );
      expect(notReviewed.data.kind).toBe("profile.invalid");
      expect(issueCodesOf(notReviewed)).toEqual(["plugin_not_reviewed"]);

      // 2. 거절(버리기)한 판은 들어가지 않는다
      const discardedId = await install(connection, other);
      await connection.request("pluginReview.decide", {
        itemId: discardedId,
        decision: { kind: "discard" },
      });
      const afterDiscard = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody("discard-profile", ["discarded-kit"]),
          baseRev: null,
        }),
      );
      expect(issueCodesOf(afterDiscard)).toEqual(["plugin_unknown"]);
      const refusedApprove = await wireErrorOf(
        connection.request("pluginReview.decide", {
          itemId: discardedId,
          decision: { kind: "approve", profileIds: [], libraryOnly: false },
        }),
      );
      expect(refusedApprove.data.kind).toBe("pluginReview.notPending");

      // 3. 승인과 함께 프로필에 넣는다. 그 프로필의 새 대화는 승인한 판을 돈다
      const approved = await connection.request("pluginReview.decide", {
        itemId: pendingItem.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(approved.item.state).toBe("approved");
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [NAME]),
        baseRev: null,
      });

      // 4. 승인 뒤 원본이 바뀌면 다시 검토로 간다. 승인한 판이 계속 돈다
      writeMarkerPlugin(home, NAME, "EDITED-2", marker);
      await connection.request("plugin.scan", {});
      const again = await connection.request("pluginReview.list", { state: "pending" });
      const update = again.items.find((entry) => entry.name === NAME);
      expect([update?.kind, update?.provenance]).toEqual(["update", "unknown"]);
      const refusedEdit = await wireErrorOf(
        connection.request("pluginReview.decide", {
          itemId: update?.itemId ?? "",
          decision: { kind: "approve", profileIds: [PROFILE], libraryOnly: false },
        }),
      );
      expect(refusedEdit.data.kind).toBe("pluginReview.handEditNotAllowed");
      const created = await connection.request("thread.create", { workspace, profileId: PROFILE });
      await runTurn(connection, collector, created.threadId, "first");
      expect(await markerAfter(marker)).toBe("APPROVED-1");
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
  "approving into the default profile works while it lists a plugin this machine lacks: the result names the missing plugin, the profile keeps it, and a thread on it runs the new plugin and skips the missing one (AGE-34)",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-install-default-")));
    const marker = join(workspace, "m");
    const source = join(workspace, "source", NAME);
    writeMarkerPluginAt(source, NAME, "INSTALL-1", marker);
    const model = recordingModels("install-default", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    // 번들 폴더가 비어 있어 공장 기본 프로필의 번들 플러그인(`helm`, `suggest`)이 이 엔진에 없다
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const before = await connection.request("profile.get", { id: "default" });
      expect(before.missingPlugins).toEqual(["helm", "suggest"]);

      const itemId = await install(connection, source);
      const decided = await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: ["default"], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      expect(decided.appliedTo).toEqual(["default"]);
      expect(decided.missingPlugins).toEqual(["helm", "suggest"]);
      const stored = await connection.request("profile.get", { id: "default" });
      const names = stored.profile.plugins.map((ref) => ref.name);
      expect([names.includes("helm"), names.at(-1)]).toEqual([true, NAME]);
      expect(stored.missingPlugins).toEqual(["helm", "suggest"]);

      // 새로 넣는 플러그인 자체가 없으면 거절한다: 이미 있던 `helm`은 이름에 오르지 않는다
      const refused = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody("default", [...names, "ghost"]),
          baseRev: stored.profile.rev,
        }),
      );
      expect(refused.data.kind).toBe("profile.invalid");
      const refusedIssues = JSON.stringify(refused.data.details);
      expect(refusedIssues).toContain('"plugin":"ghost"');
      expect(refusedIssues).toContain('"severity":"error"');
      // 만든 적 없는 프로필에 없는 플러그인을 넣는 것도 거절한다(첫 저장은 전부 새 항목이다)
      const fresh = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody(PROFILE, ["helm"]),
          baseRev: null,
        }),
      );
      expect(issueCodesOf(fresh)).toEqual(["plugin_unknown"]);

      // 그 프로필의 대화는 없는 `helm`을 건너뛰고 승인한 플러그인의 훅을 돈다
      const thread = await connection.request("thread.create", { workspace, profileId: "default" });
      await runTurn(connection, collector, thread.threadId, "hello");
      expect(await markerAfter(marker)).toContain("INSTALL-1");
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
