import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { writeMarkerPlugin } from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §4.5.7 (int, 실제 엔진): 원본 폴더 감시. 검토한 사용자 플러그인의 원본 파일을 `plugin.scan` 없이 고치면 몇 초 안에 검토함에
// `update` 항목이 생기고, 파일 여럿을 연달아 저장해도 항목은 하나이며, 같은 내용으로 다시 저장해도 항목이 늘지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "watched-plugin";

realTest(
  "editing the original files of a reviewed plugin queues exactly one update item without a scan",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-source-watch-")));
    const marker = join(workspace, "hook.marker");
    const pluginDir = writeMarkerPlugin(home, NAME, "ONE", marker);
    const model = recordingModels("source-watch", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: model.buildModels,
    });
    const connection = createHostConnection(host.client);
    const itemsOf = async () => {
      const listed = await connection.request("pluginReview.list", {});
      return listed.items.filter((item) => item.name === NAME);
    };
    const waitForItems = async (count: number, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- 기한이 있는 폴링(시험 전용)
        if ((await itemsOf()).length >= count) return true;
        if (Date.now() >= deadline) return false;
        // eslint-disable-next-line no-await-in-loop -- 기한이 있는 폴링(시험 전용)
        await Bun.sleep(100);
      }
    };
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      // 처음 훑어 검토본으로 승인한다. 이 훑기가 원본 감시도 연다
      await connection.request("plugin.scan", {});
      const first = (await itemsOf()).find((item) => item.state === "pending");
      if (first === undefined) throw new Error("the review inbox has no item for the plugin");
      await connection.request("pluginReview.decide", {
        itemId: first.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect((await itemsOf()).map((item) => item.state)).toEqual(["approved"]);

      // 파일 여럿을 연달아 저장한다(중간 상태 포함). 훑기를 부르지 않는다
      writeFileSync(join(pluginDir, "src", "extra.txt"), "partial");
      writeMarkerPlugin(home, NAME, "TWO", marker);
      writeFileSync(join(pluginDir, "src", "extra.txt"), "final");
      expect(await waitForItems(2, 15_000)).toBe(true);
      // 디바운스와 뒤 훑기가 지나도 항목은 하나다
      await Bun.sleep(2500);
      const after = await itemsOf();
      expect(after.map((item) => [item.kind, item.state])).toEqual([
        ["update", "pending"],
        ["new", "approved"],
      ]);

      // 담당 AI(테스트 대화 포함)가 같은 폴더를 제출해도 같은 내용이면 항목이 둘이 되지 않는다
      const draft = await connection.request("plugin.draft.create", { dir: pluginDir });
      const submitted = await connection.request("pluginReview.submitDraft", {
        draftId: draft.draftId,
      });
      const pendingItem = after.find((item) => item.state === "pending");
      expect(submitted.itemId).toBe(pendingItem?.itemId);
      expect((await itemsOf()).length).toBe(2);

      // 같은 내용으로 다시 써도 항목이 늘지 않는다
      writeMarkerPlugin(home, NAME, "TWO", marker);
      writeFileSync(join(pluginDir, "src", "extra.txt"), "final");
      await Bun.sleep(2500);
      expect((await itemsOf()).length).toBe(2);
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
