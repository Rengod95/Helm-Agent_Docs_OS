// 격리 자식의 `g.pluginStore`가 엔진의 저장소까지 왕복하는지 본다. 실제 자식 런타임을 메모리 파이프로 잇는다(isolated-state-wait와 같은 방식).
// 쓰기 자격은 엔진이 요청의 메서드 표지로 정하므로 readOnly 메서드의 쓰기는 자식 안에서도 거부되어야 한다(X.primitives.spec §4.6.7)
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, memoryPluginStore } from "../../src/testing/index.ts";
import { makeManifest } from "../primitives/fixtures/support.ts";
import { extension } from "./fixtures/plugin-store-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

const NAME = "ps-iso";
const MANIFEST = {
  ...makeManifest({
    name: NAME,
    methods: [
      { verb: "save", params: {}, result: {}, readOnly: false },
      { verb: "load", params: {}, result: {}, readOnly: true },
      { verb: "roWrite", params: {}, result: {}, readOnly: true },
    ],
  }),
  entry: "./plugin-store-plugin.ts",
};

test("a child's plugin store call reaches the engine store, and a readOnly method's write is refused in the child too", async () => {
  // 자식이 읽는 픽스처 엔트리(경로로 싣는다)
  expect(typeof extension).toBe("function");
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const child = createFakeProcessPort();
  const clock = createManualClock();
  await t.host.install({
    manifest: MANIFEST,
    entry: createIsolatedEntry({
      manifest: MANIFEST,
      root: FIXTURE_ROOT,
      versionId: `${NAME}-1`,
      port: child,
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
  const call = (verb: string, params: Record<string, number>) =>
    t.host.methods.call({
      extension: NAME,
      verb,
      params,
      threadId: thread,
      signal: new AbortController().signal,
      caller: "wire",
    });

  expect(await call("save", { n: 1 })).toEqual({ kind: "ok", value: "ok" });
  expect(await port.get(NAME, "note.one")).toEqual({ ok: true, value: '{"n":1}' });
  expect(await call("load", {})).toEqual({ kind: "ok", value: { n: 1 } });
  expect(await call("roWrite", {})).toEqual({ kind: "ok", value: "read_only_method" });
  expect(await port.get(NAME, "note.two")).toEqual({ ok: true, value: null });
});
