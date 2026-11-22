// 승인 전 드래프트의 플러그인 프로세스는 설정 `narrowDrafts`를 켰을 때만 좁은 길로 뜬다(`narrow: true`). 승인된 플러그인과 꺼진 설정은 열린 길이다.
// [결정: 2026-11-22, 사용자, AGE-63]
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ThreadId } from "@fresnel/contracts/conversation";
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
  ...makeManifest({ name: "lc", hooks: ["tool.execution.before"] }),
  entry: "./lifecycle-plugin.ts",
};

async function launchedSpec(narrow: (() => boolean) | undefined) {
  const t = await createTestHost();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  await t.host.install({
    manifest: MANIFEST,
    entry: createIsolatedEntry({
      manifest: MANIFEST,
      root: FIXTURE_ROOT,
      versionId: "lc-1",
      port,
      launch: () => ({ command: "plugin-host", args: [], env: {} }),
      ...(narrow === undefined ? {} : { narrow }),
      setTimer: clock.setTimer,
      now: clock.now,
      logger: recordingLogger([]),
      initTimeoutMs: 1000,
    }),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  await t.host.dispatch(
    "tool.execution.before",
    { toolCallId: "call-1", toolName: "lc-tool", args: {} },
    { threadId: thread, dispatchKey: "k1" },
  );
  return port.specs[0];
}

test("a draft's plugin process with narrowDrafts on is spawned narrow", async () => {
  const spec = await launchedSpec(() => true);
  expect(spec?.narrow).toBe(true);
  expect(spec?.readRoot).toBe(FIXTURE_ROOT);
});

test("an approved plugin, or narrowDrafts off, is spawned on the open policy (no narrow key)", async () => {
  const off = await launchedSpec(() => false);
  expect(off).toBeDefined();
  expect(off !== undefined && "narrow" in off).toBe(false);
  const absent = await launchedSpec(undefined);
  expect(absent).toBeDefined();
  expect(absent !== undefined && "narrow" in absent).toBe(false);
});
