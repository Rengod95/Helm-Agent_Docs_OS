import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import type { WireNotificationParams } from "../fixtures/notifications.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-49(M3-new-08), HS-99 (int): 다른 프로세스가 사용자 설정 파일을 바꾸면 호스트가 L0.os의 파일 감시로 알아채 메모리 층을 다시 읽고
// 연결 전체에 `settings.invalidated`를 보낸다. 알림에는 바뀐 키만 있고 값이 없다. 실제 엔진과 임시 홈 위의 시험이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.loop.maxSteps";

async function until(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 알림이 올 때까지 폴링
    await Bun.sleep(10);
  }
  expect(condition()).toBe(true);
}

realTest(
  "an edit of settings.json from outside sends settings.invalidated with the changed key, and settings.get follows",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { [KEY]: 3, "ext.same": "x" });
    const userFile = join(home.root, "config", "settings.json");
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const seen: WireNotificationParams[] = [];
    connection.onNotification("settings.invalidated", (params) => {
      seen.push(params);
    });
    expect((await connection.request("settings.get", { keys: [KEY] })).settings[0]).toMatchObject({
      value: 3,
    });

    writeFileSync(userFile, JSON.stringify({ [KEY]: 9, "ext.same": "x" }));
    await until(() => seen.length >= 1);
    expect(seen[0]).toEqual({ keys: [KEY], scopes: ["user"], threadId: null });
    expect(Object.keys(seen[0] ?? {}).toSorted()).toEqual(["keys", "scopes", "threadId"]);
    expect((await connection.request("settings.get", { keys: [KEY] })).settings[0]).toMatchObject({
      value: 9,
      source: { scope: "user" },
    });

    // 반쯤 고친 파일(JSON이 아님)은 앞 값을 둔다. 알림도 없다
    const before = seen.length;
    writeFileSync(userFile, "{ half an edit");
    await Bun.sleep(600);
    expect(seen.length).toBe(before);
    expect((await connection.request("settings.get", { keys: [KEY] })).settings[0]).toMatchObject({
      value: 9,
    });

    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);

realTest(
  "a settings.set from this host does not send a second invalidation when the watch sees its own write",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { [KEY]: 3 });
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const seen: WireNotificationParams[] = [];
    connection.onNotification("settings.invalidated", (params) => {
      seen.push(params);
    });
    await connection.request("settings.set", { key: KEY, value: 5, scope: "user" });
    await until(() => seen.length >= 1);
    await Bun.sleep(600);
    expect(seen).toEqual([{ keys: [KEY], scopes: ["user"], threadId: null }]);

    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
