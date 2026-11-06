import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { WireError } from "@fresnel/contracts/wire";
import { rejectionOf } from "../fixtures/rejection.ts";

// W-29 실제 엔진 시험: `ext.test.run`과 `ext.test.list`. 개발 모드를 켠 사용자 설정으로 Test run 대화를 연다.
// 플러그인 그룹은 뼈대에서 묶어 실제로 싣고, replay는 설치본의 엔트리를 `runInstalledReplay`(plugin-builder)로 가져와 재생한다.
// 여기서 보는 것은 개발 모드 거절, 그룹이 아닌 대상의 거절, 그룹 대상의 통과 보고, Test run 기록과 재시작 뒤 중단 표시다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "demo-plugin";
const GROUP = "demo-group";

async function startReal(home: EngineHome, settings: Readonly<Record<string, unknown>>) {
  writeUserSettings(home, settings);
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-test-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("ext-test", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

type Connection = Awaited<ReturnType<typeof startReal>>["connection"];

/** 뼈대(종류와 이름)를 묶어 설치한다. 설치본이 실려 `ext.list`에 나온다 */
async function installFromScaffold(
  connection: Connection,
  source: string,
  kind: "single-plugin" | "plugin-group",
  name: string,
): Promise<void> {
  const dir = join(source, name);
  await connection.request("ext.scaffold", { kind, name, dir });
  const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
  writeFileSync(
    manifestPath,
    readFileSync(manifestPath, "utf8").replace('"defaultEnabled": false', '"defaultEnabled": true'),
  );
  const packed = await connection.request("ext.package", { dir });
  const preview = await connection.request("ext.installPreview", { source: packed.path });
  const installed = await connection.request("ext.install", {
    source: packed.path,
    sha256: preview.sha256,
  });
  expect(installed).toMatchObject({ name, appliesAt: "now" });
  expect(installed.loadFailure).toBeUndefined();
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

const DEV_ON = { ...TAPE_SETTINGS, "l3.authoring.devMode": true };

realTest(
  "test runs over the wire: a loaded plugin opens a test run thread recorded as running; a replay of a plugin without a group is refused; a plugin group replays its installed entry and the report is recorded as passed",
  async () => {
    const home = useEngineHome();
    const source = mkdtempSync(join(tmpdir(), "ext-test-src-"));
    const session = await startReal(home, DEV_ON);
    try {
      await installFromScaffold(session.connection, source, "single-plugin", NAME);
      await installFromScaffold(session.connection, source, "plugin-group", GROUP);
      const run = await session.connection.request("ext.test.run", {
        kind: "testRun",
        target: NAME,
      });
      expect(run.threadId).not.toBeNull();
      // 표지: 이 대화는 Test run 대화다(W-34). 프로필은 없다
      const threads = await session.connection.request("thread.list", {});
      expect(threads.threads.find((item) => item.threadId === run.threadId)?.testRun).toEqual({
        profileId: null,
        target: null,
        paused: false,
      });
      // 대화 이름은 대상 확장 이름이다(제목 없음이 아니다)
      expect(threads.threads.find((item) => item.threadId === run.threadId)?.title).toBe(NAME);
      expect(await session.connection.request("ext.test.list", {})).toEqual({
        tests: [
          {
            testId: run.testId,
            kind: "testRun",
            target: NAME,
            state: "running",
            startedAt: expect.any(String),
            durationMs: null,
            threadId: run.threadId,
            replay: null,
          },
        ],
      });
      // 플러그인은 그룹이 아니라 재생할 수 없다. 기록은 늘지 않는다
      const refused = await wireErrorOf(
        session.connection.request("ext.test.run", { kind: "replay", target: NAME }),
      );
      expect(refused.data).toMatchObject({
        kind: "jsonrpc.invalidParams",
        details: {
          issues: [
            {
              path: "/target",
              message: `invalid_input: ${NAME} is not a plugin group (its manifest has no group)`,
            },
          ],
        },
      });
      // 플러그인 그룹은 그룹 검사를 지나 설치본을 재생한다. 템플릿 drive는 3단계마다 턴을 내고 커밋하므로 커밋 지점은 3개다.
      // 모든 절단이 같아 통과이고, 기록에 보고가 실린다. 재생은 대화를 만들지 않아 threadId는 null이다
      const replayed = await session.connection.request("ext.test.run", {
        kind: "replay",
        target: GROUP,
      });
      expect(replayed).toEqual({ testId: expect.any(String), threadId: null });
      const listed = await session.connection.request("ext.test.list", {});
      expect(listed).toEqual({
        tests: [
          {
            testId: run.testId,
            kind: "testRun",
            target: NAME,
            state: "running",
            startedAt: expect.any(String),
            durationMs: null,
            threadId: run.threadId,
            replay: null,
          },
          {
            testId: replayed.testId,
            kind: "replay",
            target: GROUP,
            state: "passed",
            startedAt: expect.any(String),
            durationMs: expect.any(Number),
            threadId: null,
            replay: {
              ok: true,
              commits: 3,
              passed: 3,
              firstDiff: null,
              cuts: [
                { commitIndex: 1, equal: true, firstDiff: null },
                { commitIndex: 2, equal: true, firstDiff: null },
                { commitIndex: 3, equal: true, firstDiff: null },
              ],
              effects: { turn: 3, spawn: 0, delegate: 0, post: 0 },
              failure: null,
            },
          },
        ],
      });
    } finally {
      await session.connection.close();
      await session.host.close();
      home.dispose();
      rmSync(source, { recursive: true, force: true });
    }
  },
  120_000,
);

realTest(
  "with dev mode off a replay is refused at the wire, and nothing is recorded",
  async () => {
    const home = useEngineHome();
    const session = await startReal(home, TAPE_SETTINGS);
    try {
      const refused = await wireErrorOf(
        session.connection.request("ext.test.run", { kind: "replay", target: NAME }),
      );
      expect(refused.data).toMatchObject({
        kind: "jsonrpc.invalidParams",
        details: {
          issues: [
            { path: "/target", message: "dev_mode_required: replay runs only in development mode" },
          ],
        },
      });
      expect(await session.connection.request("ext.test.list", {})).toEqual({ tests: [] });
    } finally {
      await session.connection.close();
      await session.host.close();
      home.dispose();
    }
  },
  120_000,
);

realTest(
  "a test run record survives a restart: the record stays, and the run that was still running is reported failed as interrupted",
  async () => {
    const home = useEngineHome();
    const source = mkdtempSync(join(tmpdir(), "ext-test-src-"));
    let session = await startReal(home, DEV_ON);
    try {
      await installFromScaffold(session.connection, source, "single-plugin", NAME);
      const run = await session.connection.request("ext.test.run", {
        kind: "testRun",
        target: NAME,
      });
      await session.connection.close();
      await session.host.close();
      // 다시 띄우면 같은 설정 폴더의 기록을 읽는다. 앞 프로세스의 `running`은 중단으로 바뀐다
      session = await startReal(home, DEV_ON);
      expect(await session.connection.request("ext.test.list", {})).toEqual({
        tests: [
          {
            testId: run.testId,
            kind: "testRun",
            target: NAME,
            state: "failed",
            startedAt: expect.any(String),
            durationMs: null,
            threadId: run.threadId,
            replay: null,
          },
        ],
      });
    } finally {
      await session.connection.close();
      await session.host.close();
      home.dispose();
      rmSync(source, { recursive: true, force: true });
    }
  },
  120_000,
);
