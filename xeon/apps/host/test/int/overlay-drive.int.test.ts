import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle } from "../fixtures/wire-client.ts";
import type { EventWire } from "@fresnel/contracts/wire";

// M5c §4.3.2, §4.3.4 (int, 실제 엔진): 프로필 밖의 검토된 Drive 플러그인을 `start` 항목으로 한 번 얹으면 시작 주도가 프레임을 쌓고,
// 덧씌우기는 `overlay_on`(until release)으로 남는다. 프레임이 풀리면 `overlay_off`로 끝난다. 프로필과 사용 기록은 그대로다.
// 주도는 한 단계 뒤 `done`으로 끝나므로 이 시험의 프레임은 짧다. 모델 응답은 턴 하나분이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const DRIVE = "one-time-drive";

/** 사용자 플러그인 폴더. 주도를 선언하고 첫 단계에서 끝낸다(`done`). 기본으로 켜지지 않는다 */
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
      purpose: "One-time drive for the overlay start test",
      defaultEnabled: false,
      entry: "./src/index.ts",
      // 주도를 선언한 플러그인은 그룹이어야 한다(`drive_requires_group`)
      group: {},
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(DRIVE)}, {}, (g) => {
    g.drive(async () => ({ do: "done", result: "drive finished" }));
  });
};
`,
  );
}

/** 기록의 `payload.reason`. `profile.applied`가 쓴다. 없으면 undefined */
function reasonOf(event: EventWire): unknown {
  const { payload } = event;
  return typeof payload === "object" && payload !== null && "reason" in payload
    ? payload.reason
    : undefined;
}

/** 검토함을 훑고 이름이 맞는 항목을 보관만 하도록 승인한다(프로필에는 넣지 않는다) */
async function approveByName(
  connection: ReturnType<typeof createHostConnection>,
  name: string,
): Promise<void> {
  await connection.request("plugin.scan", {});
  const listed = await connection.request("pluginReview.list", {});
  const item = listed.items.find((entry) => entry.name === name);
  if (item === undefined) throw new Error(`the review inbox has no item for ${name}`);
  const decided = await connection.request("pluginReview.decide", {
    itemId: item.itemId,
    decision: { kind: "approve", profileIds: [], libraryOnly: true },
  });
  expect(decided.item.state).toBe("approved");
}

realTest(
  "a start overlay on a reviewed drive plugin outside the profile records overlay_on before the frame, overlay_off after it releases, and leaves the profile alone",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-overlay-drive-")));
    writeDrivePlugin(home);
    const model = recordingModels("overlay-drive", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
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
        await approveByName(connection, DRIVE);
        const created = await connection.request("thread.create", { workspace });
        const profilesBefore = await connection.request("profile.list", {});

        // `/<이름>`의 시작 항목을 이번 턴에만 얹는다
        const started = await startInputWhenIdle(connection, {
          threadId: created.threadId,
          input: "start it",
          overlay: [{ plugin: DRIVE, entry: "start" }],
        });
        // 시작 요청이 큐에 든 뒤의 입력은 주도 프레임이 받는다. 그래서 턴은 아직 없다
        expect(started).toEqual({ delivered: true });
        await collector.waitFor(
          (event) => event.kind === "profile.applied" && reasonOf(event) === "overlay_off",
          30_000,
        );

        const trail = collector.events.flatMap((event) => {
          if (event.kind === "profile.applied") {
            const reason = reasonOf(event);
            return reason === "overlay_on" || reason === "overlay_off" ? [reason] : [];
          }
          return event.kind === "lease.acquired" || event.kind === "lease.released"
            ? [event.kind]
            : [];
        });
        // 기록의 순서: 덧씌우기가 켜지고, 프레임이 쌓이고, 풀리고, 덧씌우기가 꺼진다
        expect(trail).toEqual(["overlay_on", "lease.acquired", "lease.released", "overlay_off"]);
        const applied = collector.events.filter((event) => event.kind === "profile.applied");
        expect(applied.find((event) => reasonOf(event) === "overlay_on")?.payload).toMatchObject({
          reason: "overlay_on",
          overlay: [{ plugin: DRIVE, until: "release" }],
        });
        expect(applied.find((event) => reasonOf(event) === "overlay_off")?.payload).toMatchObject({
          reason: "overlay_off",
          overlay: [{ plugin: DRIVE, until: "release" }],
        });
        expect(
          collector.events.find((event) => event.kind === "lease.released")?.payload,
        ).toMatchObject({
          reason: "done",
        });

        // 프로필과 사용 기록은 덧씌우기 전과 같다
        const profilesAfter = await connection.request("profile.list", {});
        expect(profilesAfter).toEqual(profilesBefore);
      } finally {
        await connection.close();
        await host.close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  90_000,
);
