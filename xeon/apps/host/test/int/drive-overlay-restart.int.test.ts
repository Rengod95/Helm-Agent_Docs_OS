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
import {
  collectEvents,
  HELLO_PARAMS,
  startInputWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// M5c §4.3.4~5 (int, 실제 엔진): 시작 Drive 덧씌우기로 주도 프레임이 쌓인 채 엔진을 내리고 같은 홈에서 다시 연다.
// 프레임은 열 때 복원되어(`lease.acquired.contentHash`로 검토본을 맞춘다) 스택에 남고, 덧씌우기는 `overlay_on`을 다시 남기지 않고
// `open` 기록이 싣는다. 다음 입력으로 프레임이 끝나면 `overlay_off`로 짝이 맞는다. 검토본이 사라진 임대는 `restart`로 반납된다.
// 주도는 일반 입력을 `turn`으로 처리하고(모델 응답 하나) 끝내라는 입력에서 `done`으로 끝난다. 처리하지 않고 `yield`만 하면
// 엔진이 메시지를 세 단계까지 다시 부르다 코어 루프로 돌려보내므로(lease.ts `nextLast`) 시험 주도는 그렇게 쓰지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const DRIVE = "restart-drive";
const FINISH = "FINISH-NOW";
const FIRST_INPUT = "start it";

type Connection = ReturnType<typeof createHostConnection>;

/** 사용자 플러그인 폴더. 주도를 선언하고, 일반 입력은 `turn`으로 처리한 뒤 프레임에 남는다. 끝내라는 입력에서 `done`이다 */
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
      group: {},
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

/** 기록의 `payload.reason`. `profile.applied`가 쓴다. 없으면 undefined */
function reasonOf(event: EventWire): unknown {
  const { payload } = event;
  return typeof payload === "object" && payload !== null && "reason" in payload
    ? payload.reason
    : undefined;
}

/** 기록의 `payload.leaseId`. 임대 기록이 쓴다. 없으면 undefined */
function leaseIdOf(event: EventWire): unknown {
  const { payload } = event;
  return typeof payload === "object" && payload !== null && "leaseId" in payload
    ? payload.leaseId
    : undefined;
}

/** 검토함을 훑고 이름이 맞는 항목을 보관만 하도록 승인한다(프로필에는 넣지 않는다) */
async function approveByName(connection: Connection, name: string): Promise<void> {
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

function startHost(model: ReturnType<typeof recordingModels>) {
  return startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    buildModels: model.buildModels,
  });
}

/** 첫 실행: 대화를 만들고 시작 항목을 얹어 주도 프레임을 쌓는다. 프레임이 올라온 임대 id를 돌려준다 */
async function firstRun(
  connection: Connection,
  collector: EventCollector,
  workspace: string,
): Promise<{ readonly threadId: ThreadId; readonly leaseId: unknown }> {
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });
  await approveByName(connection, DRIVE);
  const created = await connection.request("thread.create", { workspace });
  const started = await startInputWhenIdle(connection, {
    threadId: created.threadId,
    input: FIRST_INPUT,
    overlay: [{ plugin: DRIVE, entry: "start" }],
  });
  // 시작 요청이 큐에 든 뒤의 입력은 주도 프레임이 받는다. 그래서 턴은 없다
  expect(started).toEqual({ delivered: true });
  const acquired = await collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
  expect(acquired.payload).toMatchObject({ scopeId: DRIVE });
  return { threadId: created.threadId, leaseId: leaseIdOf(acquired) };
}

/** 첫 실행을 한 엔진에서 돌리고, 결과와 상관없이 그 엔진을 내린다(실패해도 다음 엔진을 막지 않는다) */
async function runFirstHost(
  model: ReturnType<typeof recordingModels>,
  workspace: string,
): Promise<{ readonly threadId: ThreadId; readonly leaseId: unknown }> {
  const first = await startHost(model);
  const connection = createHostConnection(first.client);
  try {
    return await firstRun(connection, collectEvents(connection), workspace);
  } finally {
    await connection.close();
    await first.close();
  }
}

realTest(
  "a start overlay frame that is still on the stack at a restart is restored on reopen: it stays on the stack, the overlay comes back as open, and it releases with overlay_off",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-drive-restart-")));
    writeDrivePlugin(home);
    const model = recordingModels("drive-restart", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      // ── 1. 첫 실행: 주도 프레임을 쌓고 멈춘 채 엔진을 내린다 ─────────────────
      const run = await runFirstHost(model, workspace);

      // ── 2. 같은 홈에서 다시 연다 ──────────────────────────────────────────
      const second = await startHost(model);
      const connection = createHostConnection(second.client);
      const collector = collectEvents(connection);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        await connection.request("thread.open", { threadId: run.threadId, mode: "write" });
        const opened = await collector.waitFor(
          (event) => event.kind === "profile.applied" && reasonOf(event) === "open",
          30_000,
        );
        // 덧씌우기는 열린 기록이 싣는다. 다시 `overlay_on`을 남기지 않는다(이전 실행의 것이 활성 기록이다)
        expect(opened.payload).toMatchObject({
          reason: "open",
          overlay: [{ plugin: DRIVE, until: "release" }],
        });
        expect(
          collector.events.some(
            (event) => event.kind === "profile.applied" && reasonOf(event) === "overlay_on",
          ),
        ).toBe(false);

        // 프레임은 스택에 남아 있고, 그 임대는 반납되지 않았다(`restart`로 내리지 않는다)
        const frames = await connection.request("drive.frames", { threadId: run.threadId });
        expect(frames.frames.map((frame) => frame.plugin)).toEqual([null, DRIVE]);
        expect(collector.events.filter((event) => event.kind === "lease.released")).toEqual([]);

        // 끝내라는 입력은 복원된 프레임이 받아 `done`으로 끝내고, 덧씌우기는 `overlay_off`로 짝이 맞는다
        const finished = await startInputWhenIdle(connection, {
          threadId: run.threadId,
          input: FINISH,
        });
        expect(finished).toEqual({ delivered: true });
        const released = await collector.waitFor(
          (event) => event.kind === "lease.released" && leaseIdOf(event) === run.leaseId,
          30_000,
        );
        expect(released.payload).toMatchObject({ reason: "done" });
        const off = await collector.waitFor(
          (event) => event.kind === "profile.applied" && reasonOf(event) === "overlay_off",
          30_000,
        );
        expect(off.payload).toMatchObject({
          reason: "overlay_off",
          overlay: [{ plugin: DRIVE, until: "release" }],
        });
      } finally {
        await connection.close();
        await second.close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  120_000,
);

realTest(
  "a start overlay frame whose plugin was removed while the engine was down is released with restart on reopen, and no overlay comes back",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-drive-restart-gone-")));
    writeDrivePlugin(home);
    const model = recordingModels("drive-restart-gone", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const run = await runFirstHost(model, workspace);

      const second = await startHost(model);
      const connection = createHostConnection(second.client);
      const collector = collectEvents(connection);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        // 엔진이 내려간 사이 플러그인을 제거한다(제거 승인)
        const requested = await connection.request("plugin.requestRemove", { name: DRIVE });
        const decided = await connection.request("pluginReview.decide", {
          itemId: requested.itemId,
          decision: { kind: "approve", profileIds: [], libraryOnly: false },
        });
        expect(decided.item.state).toBe("approved");

        await connection.request("thread.open", { threadId: run.threadId, mode: "write" });
        const released = await collector.waitFor(
          (event) => event.kind === "lease.released" && leaseIdOf(event) === run.leaseId,
          30_000,
        );
        expect(released.payload).toMatchObject({ reason: "restart" });
        const opened = await collector.waitFor(
          (event) => event.kind === "profile.applied" && reasonOf(event) === "open",
          30_000,
        );
        expect(opened.payload).not.toMatchObject({ overlay: [{ plugin: DRIVE }] });
        const frames = await connection.request("drive.frames", { threadId: run.threadId });
        expect(frames.frames.map((frame) => frame.plugin)).toEqual([null]);
      } finally {
        await connection.close();
        await second.close();
      }
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  120_000,
);
