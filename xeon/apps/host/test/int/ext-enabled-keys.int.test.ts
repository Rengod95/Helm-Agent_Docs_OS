import { expect, test } from "bun:test";
import { startInProcessHost } from "../../src/main.ts";
import { createHostConnection } from "../../src/client.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 확장 화면의 켜기·끄기 스위치(전역은 `user`, 이 대화에서 끄기는 `launch`)가 쓰는 `ext.<이름>.enabled`가 모든 내장 확장에서 받아들여진다.
// 예전에는 helm 등 세 확장의 키만 카탈로그에 있어서 나머지는 `settings.unknownKey`로 거절됐다(F-S4-1, F-S4-2).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a built-in extension switch is writable globally and per thread, and the value reads back",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const key = "ext.cap-web.enabled";

    const global = await connection.request("settings.set", { key, value: false, scope: "user" });
    expect(global.setting).toMatchObject({ key, value: false, source: { scope: "user" } });
    const read = await connection.request("settings.get", { keys: [key] });
    expect(read.settings[0]).toMatchObject({ value: false, source: { scope: "user" } });

    const created = await connection.request("thread.create", {});
    const perThread = await connection.request("settings.set", {
      key,
      value: true,
      scope: "launch",
      threadId: created.threadId,
    });
    expect(perThread.setting).toMatchObject({ key, value: true, source: { scope: "launch" } });

    // 목록에 있는 모든 확장의 스위치 키가 받아들여진다
    const listed = await connection.request("ext.list", {});
    expect(listed.extensions.length).toBeGreaterThan(10);
    const reads = await Promise.all(
      listed.extensions.map((entry) =>
        connection.request("settings.get", { keys: [`ext.${entry.name}.enabled`] }),
      ),
    );
    for (const done of reads) expect(done.settings).toHaveLength(1);
    await connection.close();
    await host.close();
    home.dispose();
  },
  60_000,
);
