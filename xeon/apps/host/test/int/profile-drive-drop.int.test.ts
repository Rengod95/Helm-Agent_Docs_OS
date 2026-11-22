import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.1.13, §4.3.7 (int, 실제 엔진): 프로필에 든 Drive 플러그인이 주도 프레임을 쌓은 채 있을 때, 그 플러그인을 프로필에서 빼면
// 프레임은 스택에서 내려간다(`lease.released`, reason `disabled`). 빼기 전 미리 보기의 `dropsDrive`는 열린 대화 하나다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const DRIVE = "member-drive";
const PROFILE = "member-profile";
const FINISH = "FINISH-NOW";

/** 사용자 플러그인 폴더. 일반 입력은 `turn`으로 처리하고 프레임에 남는다. 끝내라는 입력에서 `done`이다 */
function writeDrivePlugin(home: EngineHome): void {
  mkdirSync(join(home.root, "config"), { recursive: true, mode: 0o700 });
  const root = join(home.root, "config", "plugins", DRIVE);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: DRIVE,
      version: "1.0.0",
      purpose: "Drive that stays on the stack until told to finish",
      defaultEnabled: false,
      entry: "./src/index.ts",
      orchestration: {},
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(DRIVE)}, {}, (g) => {
    g.drive(async ({ last }) => {
      if (last?.kind === "user") {
        if (JSON.stringify(last.message).includes(${JSON.stringify(FINISH)})) {
          return { do: "done", result: "drive finished" };
        }
        return { do: "turn", input: last.message };
      }
      return { do: "yield" };
    });
  });
};
`,
  );
}

function leaseIdOf(event: EventWire): unknown {
  const { payload } = event;
  return typeof payload === "object" && payload !== null && "leaseId" in payload
    ? payload.leaseId
    : undefined;
}

/** 이 대화에서 그 플러그인이 켜질 때까지 기다린다. 기한을 넘기면 false다 */
async function enabledOn(
  connection: ReturnType<typeof createHostConnection>,
  threadId: ThreadId,
  name: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    const listed = await connection.request("ext.list", { threadId });
    if (listed.extensions.some((entry) => entry.name === name && entry.status === "enabled")) {
      return true;
    }
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(20);
  }
  return false;
}

/** 주도 스택에서 그 플러그인의 프레임이 없어질 때까지 기다린다. 기한을 넘기면 false다 */
async function frameGone(
  connection: ReturnType<typeof createHostConnection>,
  threadId: ThreadId,
  plugin: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    const frames = await connection.request("drive.frames", { threadId });
    if (!frames.frames.some((frame) => frame.plugin === plugin)) return true;
    // oxlint-disable-next-line no-await-in-loop -- 폴링 (eng.testing.guide TS-05)
    await Bun.sleep(20);
  }
  return false;
}

realTest(
  "a profile member whose drive frame is on the stack leaves the stack when profile.put drops it: the lease is released as disabled, and the preview counted one open thread",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-profile-drive-drop-")));
    writeDrivePlugin(home);
    const model = recordingModels("profile-drive-drop", ["one.", "two."], {
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
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("plugin.scan", {});
      const listed = await connection.request("pluginReview.list", {});
      const item = listed.items.find((entry) => entry.name === DRIVE);
      if (item === undefined) throw new Error(`the review inbox has no item for ${DRIVE}`);
      await connection.request("pluginReview.decide", {
        itemId: item.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });

      // 프로필: DRIVE를 든 채 시작 Drive로 쓴다
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Member drive",
          plugins: [{ name: DRIVE }],
          settings: [],
          startDrive: DRIVE,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", { workspace });
      await connection.request("thread.setProfile", {
        threadId: created.threadId,
        profileId: PROFILE,
      });
      // 집합 전환의 적용은 다음 경계에서 끝난다. 그 뒤에 시작을 요청한다
      await collector.waitFor(
        (event) =>
          event.kind === "profile.applied" && JSON.stringify(event.payload).includes('"switched"'),
        30_000,
      );
      // 프로필의 멤버 적용은 첫 턴의 경계에서 끝난다. 그 턴을 먼저 돌린다
      const warm = await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "warm",
      });
      expect(warm).toMatchObject({ turnId: expect.any(String) });
      await collector.waitFor((event) => event.kind === "turn.completed", 30_000);
      // 켜짐 적용은 턴이 정착한 뒤 유휴 경계에서 끝난다. 이 대화에서 그 플러그인이 켜질 때까지 기다린다
      expect(await enabledOn(connection, created.threadId, DRIVE, 10_000)).toBe(true);
      // 프로필에 이미 든 플러그인의 시작 Drive는 표지 없이 주도만 요청한다(§4.3.3). 그 프레임은 프로필의 멤버가 쥔다
      const started = await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "start it",
        overlay: [{ plugin: DRIVE, entry: "start" }],
      });
      expect(started).toEqual({ delivered: true });
      const acquired = await collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
      const leaseId = leaseIdOf(acquired);
      const frames = await connection.request("drive.frames", { threadId: created.threadId });
      expect(frames.frames.map((frame) => frame.plugin)).toEqual([null, DRIVE]);
      // 덧씌우기가 아니므로 `overlay_on`은 없다
      expect(
        collector.events.some(
          (event) =>
            event.kind === "profile.applied" &&
            JSON.stringify(event.payload).includes('"overlay_on"'),
        ),
      ).toBe(false);

      // 빼기 전 미리 보기: 이 프로필을 쓰는 열린 대화 하나가 프레임을 내린다
      const preview = await connection.request("profile.preview", {
        draft: {
          id: PROFILE,
          title: "Member drive",
          plugins: [],
          settings: [],
          startDrive: null,
        },
      });
      expect(preview.dropsDrive).toEqual({ threadCount: 1 });

      // 빼기: 프레임은 `disabled`로 반납되고 스택에는 코어만 남는다. 입력이 이어질 곳이 없어 대화는 코어 루프로 돌아간다
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Member drive",
          plugins: [],
          settings: [],
          startDrive: null,
        },
        baseRev: 1,
      });
      const released = await collector.waitFor(
        (event) => event.kind === "lease.released" && leaseIdOf(event) === leaseId,
        30_000,
      );
      expect(released.payload).toMatchObject({ reason: "disabled" });
      // 반납 기록은 프레임 목록이 바뀌기 전에 남는다. 목록에서 빠질 때까지 기다린다
      expect(await frameGone(connection, created.threadId, DRIVE, 10_000)).toBe(true);
      const after = await connection.request("drive.frames", { threadId: created.threadId });
      expect(after.frames.map((frame) => frame.plugin)).toEqual([null]);

      // 코어 루프는 이어서 입력을 받는다
      const next = await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "still here",
      });
      expect(next).toMatchObject({ turnId: expect.any(String) });
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  120_000,
);
