// 관찰 알림 시험(PLUGIN_HOST_NOTIFY_HOOKS, isolation/proxy-entry.ts): 스트림 훅은 `event.notify`로 자식에 보내고 기다리지 않는다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { extension } from "./fixtures/notify-plugin.ts";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

const MANIFEST = {
  ...makeManifest({ name: "nt", hooks: ["request.stream"] }),
  entry: "./notify-plugin.ts",
};

test("an observation hook is sent as an event notification and the dispatch does not wait for the plugin", async () => {
  // 자식은 확장 루트의 경로로 이 픽스처를 싣고 `extension` 내보내기를 엔트리로 쓴다
  expect(typeof extension).toBe("function");
  const t = await createTestHost();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const entry = createIsolatedEntry({
    manifest: MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "nt-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
  await t.host.install({ manifest: MANIFEST, entry, loadIndex: 0, builtin: false, trust: "user" });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const payload = { provider: "p", api: "a", model: "m", data: { delta: "x" } };

  // 자식의 처리기는 응답하지 않는데도 디스패치가 돌아온다(알림은 기다리지 않는다)
  await t.host.dispatch("request.stream", payload, { threadId: thread, dispatchKey: "k1" });
  await until(
    () => port.children[0]?.received().includes('"eventKey":"nt:request.stream:0#1"') === true,
    "the first event notification",
  );
  await t.host.dispatch("request.stream", payload, { threadId: thread, dispatchKey: "k2" });
  await until(
    () => port.children[0]?.received().includes('"eventKey":"nt:request.stream:0#2"') === true,
    "the second event notification",
  );
  expect(port.children.length).toBe(1);
  expect(port.children[0]?.received()).toContain('"method":"event.notify"');
  expect(port.children[0]?.received()).not.toContain('"method":"hook.invoke"');
});
