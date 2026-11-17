// 격리 `g.subscribe`(coalesce) 시험. 자식 안의 구독이 엔진 안의 같은 구독과 같은 봉투 모양을 받는지 값으로 비교한다:
// `eventKey`는 엔진 디스패치 키이고 순서대로 나오며, 덮인 구간의 `dropped`가 같아야 한다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createIsolatedEntry } from "../../src/index.ts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import {
  arm,
  extension,
  release,
  seen,
  type SeenEnvelope,
} from "./fixtures/subscribe-notify-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));
const MANIFEST = {
  ...makeManifest({ name: "sn", hooks: ["request.stream"] }),
  entry: "./subscribe-notify-plugin.ts",
};
const TOOL_UPDATE_PAYLOAD = { provider: "p", api: "a", model: "m", data: { delta: "x" } };
const KEYS = ["c1", "c2", "c3"] as const;

/** 디스패치 하나를 같은 대화에 보낸다 */
async function dispatchOne(t: TestHost, thread: ThreadId, key: string): Promise<void> {
  await t.host.dispatch("request.stream", TOOL_UPDATE_PAYLOAD, {
    threadId: thread,
    dispatchKey: key,
  });
}

/** 같은 대화에 디스패치를 발화 순서대로 보낸다. 앞의 디스패치가 끝난 뒤 다음을 보낸다 */
async function dispatchInOrder(t: TestHost, thread: ThreadId): Promise<void> {
  await KEYS.reduce<Promise<void>>(
    (chain, key) => chain.then(() => dispatchOne(t, thread, key)),
    Promise.resolve(),
  );
}

test("an isolated coalesce subscription receives the same envelopes as an in-engine one", async () => {
  // 격리: 자식 안의 구독이 실제로 돈다
  arm();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const events: string[] = [];
  const isolated = await createTestHost();
  const isolatedEntry = createIsolatedEntry({
    manifest: MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "sn-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger(events),
    initTimeoutMs: 1000,
  });
  await isolated.host.install({
    manifest: MANIFEST,
    entry: isolatedEntry,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const isolatedThread = isolated.newThread();
  await isolated.host.openThread(isolatedThread);
  await dispatchInOrder(isolated, isolatedThread);
  // 첫 전달은 막혀 있다. 셋째 알림의 확인이 오면 셋째까지 구독자의 대기 칸에 든 것이다(둘째는 셋째가 덮는다)
  await until(
    () =>
      port.children[0]?.emitted().includes('"params":{"eventKey":"sn:request.stream:0#3"}') ===
      true,
    "the acknowledgment of the third notification",
  );
  const isolatedChild = port.children[0];
  expect(isolatedChild?.emitted()).toContain('"method":"event.done"');
  release();
  await until(() => seen.length === 2, "the coalesced delivery");
  const isolatedSeen: SeenEnvelope[] = seen.map((item) => ({
    eventKey: item.eventKey,
    dropped: item.dropped,
  }));

  // 엔진 안: 같은 픽스처를 엔진 안에서 돌린다
  arm();
  const inEngine = await createTestHost();
  await inEngine.host.install({
    manifest: MANIFEST,
    entry: extension,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const engineThread = inEngine.newThread();
  await inEngine.host.openThread(engineThread);
  await dispatchInOrder(inEngine, engineThread);
  release();
  await inEngine.settled();
  const engineSeen: SeenEnvelope[] = seen.map((item) => ({
    eventKey: item.eventKey,
    dropped: item.dropped,
  }));

  expect(isolatedSeen).toEqual([
    { eventKey: "c1", dropped: 0 },
    { eventKey: "c3", dropped: 1 },
  ]);
  expect(isolatedSeen).toEqual(engineSeen);
});
