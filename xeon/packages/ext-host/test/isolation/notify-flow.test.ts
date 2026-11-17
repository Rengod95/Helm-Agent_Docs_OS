// 격리 알림의 흐름 제어 시험(isolation/notify-gate.ts). 엔진은 확인(`event.done`)이 오기 전에 보낸 알림을 키마다 상한까지만
// 보내고, 나머지는 대기 칸 하나에 덮어쓰며 덮인 수를 `dropped`로 싣는다. 보내기는 기다리지 않는다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createIsolatedEntry } from "../../src/index.ts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { NOTIFY_INFLIGHT_MAX, NOTIFY_STALL_MS } from "../../src/isolation/notify-gate.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import { extension, releaseOne, startFlowCase } from "./fixtures/notify-flow-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeChild,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

/** 시험이 고정하는 값(스펙의 [제안] 값). 상수를 바꾸면 아래 시험이 실패한다 */
const INFLIGHT = 8;
const STALL = 30_000;

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));
const MANIFEST = {
  ...makeManifest({ name: "ng", hooks: ["request.stream"] }),
  entry: "./notify-flow-plugin.ts",
};

interface Harness {
  readonly t: TestHost;
  readonly port: FakeProcessPort;
  readonly clock: ManualClock;
  readonly events: string[];
  readonly thread: ThreadId;
}

async function harness(): Promise<Harness> {
  startFlowCase();
  const t = await createTestHost();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const events: string[] = [];
  const entry = createIsolatedEntry({
    manifest: MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "ng-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger(events),
    initTimeoutMs: 1000,
  });
  await t.host.install({ manifest: MANIFEST, entry, loadIndex: 0, builtin: false, trust: "user" });
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, port, clock, events, thread };
}

/** 스트림 알림 하나를 디스패치한다. 델타 값으로 알림마다 다른 본문을 준다 */
async function stream(h: Harness, index: number, thread: ThreadId = h.thread): Promise<void> {
  await h.t.host.dispatch(
    "request.stream",
    { provider: "p", api: "a", model: "m", data: { delta: `n${index}` } },
    { threadId: thread, dispatchKey: `k${index}` },
  );
}

/** 번호 범위를 순서대로 돌린다 */
function range(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

/** 번호 범위의 알림을 순서대로 디스패치한다. 앞의 디스패치가 끝난 뒤 다음을 보내므로 엔진의 발화 순서가 번호 순서다 */
async function streamRange(h: Harness, from: number, to: number, offset = 0): Promise<void> {
  await range(from, to).reduce<Promise<void>>(
    (chain, index) => chain.then(() => stream(h, index + offset)),
    Promise.resolve(),
  );
}

/** 자식이 받은 `event.notify` 프레임 수. 엔진이 쓴 바이트를 세므로 보내기 여부를 직접 본다 */
function notifyCount(child: FakeChild | undefined): number {
  return (child?.received().split('"method":"event.notify"').length ?? 1) - 1;
}

/** 엔진이 보낸 바이트가 쓰일 때까지 짧게 기다린다. 알림 보내기는 마이크로태스크로 일어난다 */
async function settleWrites(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
}

test("below the inflight limit every notification is sent in order with no dropped count", async () => {
  // 자식은 확장 루트의 이 파일을 `extension`으로 싣는다(경로로 읽으므로 시험이 직접 쓰지 않는다)
  expect(typeof extension).toBe("function");
  const h = await harness();
  await streamRange(h, 1, 3);
  await until(() => notifyCount(h.port.children[0]) === 3, "three notifications");
  const sent = h.port.children[0]?.received() ?? "";
  expect(sent.indexOf('"eventKey":"ng:request.stream:0#1"')).toBeLessThan(
    sent.indexOf('"eventKey":"ng:request.stream:0#2"'),
  );
  expect(sent).not.toContain('"dropped"');
});

test("a slow child gets at most the inflight limit, the rest coalesce into one slot, and the dispatch never waits", async () => {
  const h = await harness();
  // 엔진이 보내는 동안 디스패치가 돌아와야 한다. 자식은 처리를 끝내지 않으므로 확인이 오지 않는다
  await streamRange(h, 1, INFLIGHT);
  await until(() => notifyCount(h.port.children[0]) === INFLIGHT, "the limit");
  await streamRange(h, INFLIGHT + 1, INFLIGHT + 100);
  await settleWrites();
  expect(notifyCount(h.port.children[0])).toBe(INFLIGHT);
});

test("one event.done sends the latest coalesced notification once, with dropped set to the number it covers", async () => {
  const h = await harness();
  const LAST = INFLIGHT + 100;
  await streamRange(h, 1, LAST);
  await settleWrites();
  const child = h.port.children[0];
  expect(notifyCount(child)).toBe(INFLIGHT);
  // 자식이 첫 알림의 처리를 끝내 확인을 보낸다
  expect(releaseOne()).toBe(true);
  await until(() => notifyCount(child) === INFLIGHT + 1, "the coalesced notification");
  const sent = child?.received() ?? "";
  // 9번부터 108번까지 100개 가운데 108번만 나가고, 앞의 99개가 덮였다. 본문은 가장 최신 것이다
  expect(sent).toContain(`"eventKey":"ng:request.stream:0#${LAST}"`);
  expect(sent).toContain(`"delta":"n${LAST}"`);
  expect(sent).toContain(`"dropped":${LAST - INFLIGHT - 1}`);
  expect(notifyCount(child)).toBe(INFLIGHT + 1);
});

test("the limit is kept per route: another thread is sent at once while this one is full", async () => {
  const h = await harness();
  await streamRange(h, 1, INFLIGHT);
  await until(() => notifyCount(h.port.children[0]) === INFLIGHT, "the limit");
  const other = h.t.newThread();
  await h.t.host.openThread(other);
  await stream(h, INFLIGHT + 1, other);
  await until(() => notifyCount(h.port.children[0]) === INFLIGHT + 1, "the other thread");
  expect(h.port.children[0]?.received()).toContain(`"threadId":"${other}"`);
});

test("a restarted child starts from zero unacknowledged notifications", async () => {
  const h = await harness();
  await streamRange(h, 1, INFLIGHT);
  await until(() => notifyCount(h.port.children[0]) === INFLIGHT, "the limit");
  h.port.children[0]?.crash();
  await until(() => h.events.includes("plugin_host.exited"), "the exit");
  await streamRange(h, 1, INFLIGHT, 100);
  await until(() => notifyCount(h.port.children[1]) === INFLIGHT, "the new child");
  expect(h.port.children[1]?.received()).not.toContain('"dropped"');
});

test("a child that never acknowledges is unstuck after the stall time, with a diagnostic", async () => {
  const h = await harness();
  // 상한 8개를 보내고 그다음 한 개를 대기 칸에 둔다
  await streamRange(h, 1, INFLIGHT + 1);
  await settleWrites();
  const child = h.port.children[0];
  expect(notifyCount(child)).toBe(INFLIGHT);
  h.clock.advance(STALL);
  await until(() => notifyCount(child) === INFLIGHT + 1, "the slot after the stall");
  expect(h.events).toContain("plugin_host.notify_stalled");
  expect(child?.received()).toContain(`"eventKey":"ng:request.stream:0#${INFLIGHT + 1}"`);
});

test("the child acknowledges a notification only after its handler has finished", async () => {
  const h = await harness();
  await stream(h, 1);
  await until(() => notifyCount(h.port.children[0]) === 1, "the notification");
  const child = h.port.children[0];
  expect(child?.emitted()).not.toContain('"method":"event.done"');
  expect(releaseOne()).toBe(true);
  await until(
    () => child?.emitted().includes('"params":{"eventKey":"ng:request.stream:0#1"}') === true,
    "the acknowledgment",
  );
  expect(child?.emitted()).toContain(
    '{"method":"event.done","params":{"eventKey":"ng:request.stream:0#1"}}',
  );
});

test("the spec values are an inflight limit of 8 and a stall time of 30 seconds", () => {
  expect(NOTIFY_INFLIGHT_MAX).toBe(INFLIGHT);
  expect(NOTIFY_STALL_MS).toBe(STALL);
});
