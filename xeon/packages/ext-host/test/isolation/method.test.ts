// 확장 메서드 시험(대리 등록의 `registerMethod`): 엔진의 메서드 호출이 격리 자식의 처리기로 가고, 응답이 결과로 돌아온다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { extension } from "./fixtures/method-plugin.ts";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

const MANIFEST = {
  ...makeManifest({
    name: "mt",
    methods: [{ verb: "ping", params: {}, result: {}, readOnly: false }],
  }),
  entry: "./method-plugin.ts",
};

test("an extension method call reaches the isolated plugin and its reply is the outcome", async () => {
  // 자식은 확장 루트의 경로로 이 픽스처를 싣고 `extension` 내보내기를 엔트리로 쓴다
  expect(typeof extension).toBe("function");
  const t = await createTestHost();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  await t.host.install({
    manifest: MANIFEST,
    entry: createIsolatedEntry({
      manifest: MANIFEST,
      root: FIXTURE_ROOT,
      versionId: "mt-1",
      port,
      launch: () => ({ command: "plugin-host", args: [], env: {} }),
      setTimer: clock.setTimer,
      now: clock.now,
      logger: recordingLogger([]),
      initTimeoutMs: 1000,
    }),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcome = await t.host.methods.call({
    extension: "mt",
    verb: "ping",
    params: { n: 2 },
    threadId: thread,
    signal: new AbortController().signal,
    caller: "wire",
  });
  expect(outcome).toEqual({ kind: "ok", value: { n: 2 } });
  expect(port.children[0]?.received()).toContain('"method.call"');
});
