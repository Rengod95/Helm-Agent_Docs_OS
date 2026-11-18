import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { sequencedModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// `blocks.applied`(M5e-2, 스펙 §4.9)를 실제 엔진으로 시험한다. 실제 엔진이 답하고, 설정은 엔진 홈의 파일과 `settings.set`으로 바뀐다.
// 값을 새로 계산하는 가짜 원천은 쓰지 않는다. 읽는 값은 `hooks.list`와 `settings.explain`이 같은 원천에서 내는 값과 맞춘다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CALL = "tool.call.before";
const PROBE_A = "ext-blocks-a";
const PROBE_B = "ext-blocks-b";
const KEY = "l1.context.autoCompact";

function writeHookProbe(home: EngineHome, name: string, hook: string): void {
  const root = join(home.root, "config", "extensions", name);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [hook] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on(${JSON.stringify(hook)}, () => {});
  });
};
`,
  );
}

async function openHost() {
  const host = await startInProcessHost({
    pluginHost: { disabled: true },
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "blocks-applied-bundles-")),
    buildModels: sequencedModels("blocks-applied-real", ["하나."]),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

realTest(
  "blocks.applied returns the thread's real block composition: setting values with their source, parts, and the handlers in dispatch order",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE_A, CALL);
    writeHookProbe(home, PROBE_B, CALL);
    const { host, connection } = await openHost();
    try {
      const created = await connection.request("thread.create", {});
      const before = await connection.request("blocks.applied", { threadId: created.threadId });
      expect(before.profileId).toBe("default");
      expect(before.blocks.map((block) => block.id)).toEqual([
        "context",
        "model",
        "tools",
        "ask",
        "agents",
        "record",
      ]);
      const contextBefore = before.blocks.find((block) => block.id === "context");
      expect(contextBefore?.settings.find((entry) => entry.key === KEY)).toEqual({
        key: KEY,
        value: true,
        source: "default",
      });

      // 설정 파일(user 범위)이 바뀌면 값과 출처가 따라온다
      await connection.request("settings.set", { key: KEY, value: false, scope: "user" });
      const after = await connection.request("blocks.applied", { threadId: created.threadId });
      const contextAfter = after.blocks.find((block) => block.id === "context");
      expect(contextAfter?.settings.find((entry) => entry.key === KEY)).toEqual({
        key: KEY,
        value: false,
        source: "user",
      });
      const explained = await connection.request("settings.explain", {
        key: KEY,
        threadId: created.threadId,
      });
      expect(explained.winningScope).toBe("user");

      // 부품은 기본 구현이 쓰인다(대체한 플러그인이 없다)
      const tools = after.blocks.find((block) => block.id === "tools");
      expect(tools?.parts.find((part) => part.id === "tool:edit")).toEqual({
        id: "tool:edit",
        current: "cap-workspace",
      });

      // 핸들러: 그 블록의 앞 훅 `tool.call.before`에 선 핸들러가 `hooks.list`의 디스패치 순서와 같고 order는 0부터 이어진다
      const listed = await connection.request("hooks.list", {});
      const row = listed.hooks.find((entry) => entry.hook === CALL);
      const expectedPlugins = (row?.order ?? []).map((entry) => entry.extension);
      const handlers = (tools?.handlers ?? []).filter((entry) => entry.hook === CALL);
      expect(handlers.map((entry) => entry.order)).toEqual(handlers.map((_, index) => index));
      expect(handlers.map((entry) => entry.plugin)).toEqual(
        expectedPlugins.filter((name) => handlers.some((entry) => entry.plugin === name)),
      );
      // 다른 블록에는 이 훅이 나오지 않는다
      expect(
        after.blocks
          .filter((block) => block.id !== "tools")
          .some((block) => block.handlers.some((entry) => entry.hook === CALL)),
      ).toBe(false);

      // 모르는 대화와 프로필은 찾을 수 없다
      const missing = await connection
        .request("blocks.applied", { profileId: "no-such-profile" })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(missing).toMatchObject({ data: { kind: "profile.notFound" } });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
