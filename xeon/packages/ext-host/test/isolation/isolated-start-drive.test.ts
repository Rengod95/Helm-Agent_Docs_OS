// 격리 호스트의 주도 시작(`startDrive`) 시험. 자식이 부른 시작 요청은 엔진 왕복으로 가고 값으로 돌아온다.
// 격리 등록은 드라이브를 가질 수 없어 엔진의 답은 `not_drive`이고, 설치 때 부른 것은 문맥이 없어 `no_context`다.
// 큐에 든 요청의 값(범위, thread, 입력, trigger)은 엔진 라우터 시험(engine-calls.test.ts)이 드라이브 단계로 본다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { CommandResourceDef } from "../../src/primitives/resources.ts";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import { extension as startDriveExtension } from "./fixtures/start-drive-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

/** 시작 픽스처의 매니페스트. 등록 이름은 `sd`다 */
const START_MANIFEST = {
  ...makeManifest({ name: "sd", hooks: [] }),
  entry: "./start-drive-plugin.ts",
};

function isolatedEntry(port: FakeProcessPort, clock: ManualClock) {
  return createIsolatedEntry({
    manifest: START_MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "sd-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
}

/** 같은 픽스처를 격리 호스트로 올리고 설치 상태가 `applied`인지 확인한다 */
async function installIsolated(
  t: TestHost,
  port: FakeProcessPort,
  clock: ManualClock,
): Promise<void> {
  const outcome = await t.host.install({
    manifest: START_MANIFEST,
    entry: isolatedEntry(port, clock),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
}

function isCommandDef(value: unknown): value is CommandResourceDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "handler" in value &&
    typeof value.handler === "function"
  );
}

function commandNamed(t: TestHost, name: string): CommandResourceDef {
  const def = t.host.resources.list("command").find((record) => record.name === name)?.def;
  if (!isCommandDef(def)) throw new Error(`no command ${name}`);
  return def;
}

function ctxOf(thread: ThreadId, invocationId: string) {
  return { threadId: thread, invocationId, signal: new AbortController().signal };
}

/** 격리 픽스처를 올린 호스트. 스레드는 열려 있다 */
async function isolatedHost(): Promise<{
  readonly t: TestHost;
  readonly port: FakeProcessPort;
  readonly thread: ThreadId;
}> {
  const t = await createTestHost();
  const port = createFakeProcessPort();
  await installIsolated(t, port, createManualClock());
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, port, thread };
}

test("startDrive in a command is an engine call that carries the input and comes back as the engine's refusal value", async () => {
  const { t, port, thread } = await isolatedHost();
  expect(await commandNamed(t, "start").handler("", ctxOf(thread, "inv-start"))).toBe(
    "refused not_drive",
  );
  // 명령의 요청 id가 붙고 입력은 `{topic: "t"}`다. 값으로 비교한다(자식이 보낸 줄)
  expect(port.children[0]?.emitted()).toMatch(
    /"method":"startDrive","registration":"sd","requestId":\d+,"params":\{"input":\{"topic":"t"\}\}\}/,
  );
});

test("a startDrive with no input sends a null input, and the setup-time call is no_context without asking the engine", async () => {
  const { t, port, thread } = await isolatedHost();
  // 설치 때 부른 것은 문맥이 없어 자식이 `no_context`로 답한다. 엔진으로 가는 호출이 없다(설치 중에는 엔진이 등록을 아직 모른다)
  expect(port.children[0]?.emitted()).not.toContain('"method":"startDrive"');
  expect(await commandNamed(t, "early").handler("", ctxOf(thread, "inv-early"))).toBe(
    "refused no_context",
  );
  expect(await commandNamed(t, "bare").handler("", ctxOf(thread, "inv-bare"))).toBe(
    "refused not_drive",
  );
  // 명령의 호출만 엔진에 가고 입력이 없으면 null이다
  expect(port.children[0]?.emitted()).toMatch(
    /"method":"startDrive","registration":"sd","requestId":\d+,"params":\{"input":null\}\}/,
  );
});

test("the same fixture inside the engine gives the same refusals for the same calls", async () => {
  const inEngine = await createTestHost();
  const outcome = await inEngine.host.install({
    manifest: START_MANIFEST,
    entry: startDriveExtension,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const thread = inEngine.newThread();
  await inEngine.host.openThread(thread);
  expect(await commandNamed(inEngine, "early").handler("", ctxOf(thread, "inv-early"))).toBe(
    "refused no_context",
  );
  expect(await commandNamed(inEngine, "start").handler("", ctxOf(thread, "inv-start"))).toBe(
    "refused not_drive",
  );
});
