// 수명 시험(대리 등록의 정리와 세션): 등록을 끄면 자식의 정리 동작을 부르고 마지막 등록이 꺼지면 프로세스를 내린다.
// 다시 켜면 같은 확장이 새 프로세스로 다시 돈다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PluginHostSupervisor } from "../../src/isolation/supervisor.ts";
import { extension } from "./fixtures/lifecycle-plugin.ts";
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
  ...makeManifest({ name: "lc", hooks: ["tool.execution.before"] }),
  entry: "./lifecycle-plugin.ts",
};

test("disabling the last scope runs the child's disposers and stops the process; enabling again relaunches it", async () => {
  // 자식은 확장 루트의 경로로 이 픽스처를 싣고 `extension` 내보내기를 엔트리로 쓴다
  expect(typeof extension).toBe("function");
  const t = await createTestHost();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const sessions: PluginHostSupervisor[] = [];
  await t.host.install({
    manifest: MANIFEST,
    entry: createIsolatedEntry({
      manifest: MANIFEST,
      root: FIXTURE_ROOT,
      versionId: "lc-1",
      port,
      launch: () => ({ command: "plugin-host", args: [], env: {} }),
      setTimer: clock.setTimer,
      now: clock.now,
      logger: recordingLogger([]),
      initTimeoutMs: 1000,
      onSupervisor: (supervisor) => {
        sessions.push(supervisor);
      },
    }),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const tap = { toolCallId: "call-1", toolName: "lc-tool", args: {} };
  await t.host.dispatch("tool.execution.before", tap, { threadId: thread, dispatchKey: "k1" });
  expect(port.children.length).toBe(1);
  expect(sessions.length).toBe(1);

  // 끄기: 정리 동작을 부르고, 마지막 등록이 꺼졌으므로 세션을 `disabled`로 닫는다
  t.host.registration("lc")?.disable();
  await t.boundary(thread).idle();
  await until(
    () => port.children[0]?.received().includes('"scope.dispose"') === true,
    "scope.dispose",
  );
  expect(port.children[0]?.received()).toContain('"reason":"disabled"');
  await until(() => sessions[0]?.status().state === "stopped", "the session to stop");

  // 다시 켜기: 등록이 다시 설치되고 다음 호출이 새 프로세스를 띄운다
  t.host.registration("lc")?.enable();
  await t.boundary(thread).idle();
  await t.host.dispatch("tool.execution.before", tap, { threadId: thread, dispatchKey: "k2" });
  expect(port.children.length).toBe(2);
  expect(port.children[1]?.received()).toContain('"hook.invoke"');
  expect(sessions[1]?.status().state).toBe("running");
});
