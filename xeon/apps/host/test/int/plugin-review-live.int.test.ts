import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { writeMarkerPlugin } from "../fixtures/plugin-review.ts";
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

// M5c §4.5.8, §4.6.7, §4.7.4, §8 수용 27·29·36 (int, 실제 엔진): 검토한 사용자 플러그인의 원본 폴더를 바꿔도 다음 턴은 검토본 판을 돌린다.
// 원본 변화는 `plugin.scan`으로 `update` 항목이 되고(손 수정이라 승인은 거부된다), 담당 AI가 새 버전을 제출한 `update` 항목을 승인해야
// 다음 턴부터 새 코드가 돈다. 승인 뒤 열린 대화는 `profile.applied { reason: "plugin_updated", updated }`를 남긴다.
// 표지 파일(`marker`)의 글로 어느 판이 돌았는지 본다. 훅은 `turn.completed` 뒤에 정산되므로 표지를 기다려 읽는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "live-hook";
const PROFILE = "live-profile";
const REVIEWED = "REVIEWED-1";
const EDITED = "EDITED-2";
const ASSISTANT = "ASSISTANT-3";

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 턴을 돌리고 끝날 때까지 기다린다 */
async function runTurn(
  connection: ReturnType<typeof createHostConnection>,
  collector: EventCollector,
  threadId: ThreadId,
  input: string,
): Promise<void> {
  const started = await startTurnWhenIdle(connection, { threadId, input });
  await collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
}

/** 훅이 쓴 표지 글을 읽는다. 표지가 생길 때까지 기다리고, 기한을 넘기면 던진다 */
async function markerAfter(marker: string): Promise<string> {
  if (!(await until(() => existsSync(marker), 10_000))) {
    throw new Error(`the hook did not write ${marker}`);
  }
  return readFileSync(marker, "utf8");
}

realTest(
  "after a review, editing the original folder keeps the next turn on the reviewed copy; a hand edit is refused, and approving the assistant's new version moves the thread to the new code",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-review-live-")));
    const marker = join(workspace, "hook.marker");
    const pluginDir = writeMarkerPlugin(home, NAME, REVIEWED, marker);
    const model = recordingModels("review-live", ["one.", "two.", "three.", "four."], {
      contextWindow: 200_000,
    });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: model.buildModels,
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      // 1. 처음 검토해 보관으로 승인하고, 그 프로필에 넣은 대화를 연다
      await connection.request("plugin.scan", {});
      const first = await connection.request("pluginReview.list", { state: "pending" });
      const newItem = first.items.find((item) => item.name === NAME);
      if (newItem === undefined) throw new Error("the review inbox has no item for the plugin");
      expect(newItem.kind).toBe("new");
      await connection.request("pluginReview.decide", {
        itemId: newItem.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Live",
          plugins: [{ name: NAME }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", {
        workspace,
        profileId: PROFILE,
      });

      // 2. 검토본 판이 돈다
      await runTurn(connection, collector, created.threadId, "first");
      expect(await markerAfter(marker)).toBe(REVIEWED);
      rmSync(marker, { force: true });

      // 3. 원본 폴더의 훅 코드를 바꾸고 훑으면 `update` 항목이 하나 생긴다. 실행 판은 그대로다
      writeMarkerPlugin(home, NAME, EDITED, marker);
      const scanned = await connection.request("plugin.scan", {});
      expect(scanned.queued).toHaveLength(1);
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      const handEdit = pending.items.find((item) => item.name === NAME);
      if (handEdit === undefined) throw new Error("the edit did not create an item");
      expect([handEdit.kind, handEdit.state, handEdit.provenance]).toEqual([
        "update",
        "pending",
        "unknown",
      ]);

      // 4. 승인 전 다음 턴도 검토본 판이다. 원본의 새 코드는 돌지 않는다
      await runTurn(connection, collector, created.threadId, "second");
      expect(await markerAfter(marker)).toBe(REVIEWED);
      rmSync(marker, { force: true });

      // 4b. 손 수정은 승인할 수 없다(§4.7.4). 거부되고 항목은 대기로 남는다
      const refused = await rejectionOf(
        connection.request("pluginReview.decide", {
          itemId: handEdit.itemId,
          decision: { kind: "approve", profileIds: [], libraryOnly: false },
        }),
      );
      expect(refused instanceof WireError ? refused.data.kind : null).toBe(
        "pluginReview.handEditNotAllowed",
      );
      const stillPending = await connection.request("pluginReview.get", {
        itemId: handEdit.itemId,
      });
      expect(stillPending.item.state).toBe("pending");

      // 4c. 담당 AI가 폴더를 고쳐 새 버전으로 제출한다(`assistant`인 `update` 항목). 다른 해시이므로 손 수정 항목은 `superseded`다.
      // 승인 전에는 검토본 판이 계속 돈다
      writeMarkerPlugin(home, NAME, ASSISTANT, marker);
      const draft = await connection.request("plugin.draft.create", {
        dir: pluginDir,
        originThreadId: created.threadId,
      });
      const submitted = await connection.request("pluginReview.submitDraft", {
        draftId: draft.draftId,
      });
      const assistant = await connection.request("pluginReview.get", {
        itemId: submitted.itemId,
      });
      expect([assistant.item.kind, assistant.item.state, assistant.item.provenance]).toEqual([
        "update",
        "pending",
        "assistant",
      ]);
      const superseded = await connection.request("pluginReview.get", { itemId: handEdit.itemId });
      expect(superseded.item.state).toBe("superseded");
      await runTurn(connection, collector, created.threadId, "third");
      expect(await markerAfter(marker)).toBe(REVIEWED);
      rmSync(marker, { force: true });

      // 5. 승인하면 다음 턴부터 새 코드가 돈다. 열린 대화는 `plugin_updated`를 남긴다
      const decided = await connection.request("pluginReview.decide", {
        itemId: submitted.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: false },
      });
      expect(decided.item.state).toBe("approved");
      await runTurn(connection, collector, created.threadId, "fourth");
      expect(await markerAfter(marker)).toBe(ASSISTANT);

      const updated = collector.events
        .filter((event) => event.kind === "profile.applied")
        .map((event) => recordOf(event.payload))
        .filter((payload) => payload["reason"] === "plugin_updated");
      expect(updated.map((payload) => [payload["profileId"], payload["updated"]])).toEqual([
        [
          PROFILE,
          [
            {
              plugin: NAME,
              fromHash: assistant.item.baseHash,
              toHash: assistant.item.candidateHash,
            },
          ],
        ],
      ]);
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
