import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import type { WireNotificationParams } from "../fixtures/notifications.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// G1-08 (int): 실제 엔진에서 설정 쓰기와 신뢰 결정이 연결 전체에 settings.invalidated를 보낸다. 알림에는 값이 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.loop.maxSteps";

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 알림이 올 때까지 폴링
    await Bun.sleep(5);
  }
  expect(condition()).toBe(true);
}

realTest(
  "set, reset and a trust decision each send settings.invalidated with keys, scopes and thread",
  async () => {
    const home = useEngineHome();
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-inv-")));
    mkdirSync(join(workspace, ".xeon"));
    writeFileSync(join(workspace, ".xeon", "settings.json"), JSON.stringify({ [KEY]: 8 }));
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const seen: WireNotificationParams[] = [];
    connection.onNotification("settings.invalidated", (params) => {
      seen.push(params);
    });
    const created = await connection.request("thread.create", { workspace });

    await connection.request("settings.set", { key: KEY, value: 5, scope: "user" });
    await until(() => seen.length === 1);
    await connection.request("settings.set", {
      key: KEY,
      value: 6,
      scope: "session",
      threadId: created.threadId,
    });
    await until(() => seen.length === 2);
    await connection.request("settings.reset", { key: KEY, scope: "user" });
    await until(() => seen.length === 3);
    await connection.request("trust.decide", {
      workspace,
      choice: { kind: "folder", verdict: "allow" },
    });
    await until(() => seen.length === 4);

    expect(seen).toEqual([
      { keys: [KEY], scopes: ["user"], threadId: null },
      { keys: [KEY], scopes: ["session"], threadId: created.threadId },
      { keys: [KEY], scopes: ["user"], threadId: null },
      { keys: [], scopes: ["project", "local"], threadId: null },
    ]);
    // 값은 알림에 없다: 필드는 이 셋뿐이다
    for (const params of seen)
      expect(Object.keys(params).toSorted()).toEqual(["keys", "scopes", "threadId"]);
    await connection.close();
    await host.close();
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  },
  30_000,
);
