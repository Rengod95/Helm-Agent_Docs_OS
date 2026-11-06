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

// 내장 그룹(authoring, 기본 꺼짐)의 켜기 스위치가 값만 쓰는 것이 아니라 실제로 켜고 끈다(rtC R-3).
realTest(
  "turning the authoring group on through its setting enables it and turning it off disables it",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const key = "ext.authoring.enabled";
    const statusOf = async (): Promise<string | undefined> => {
      const listed = await connection.request("ext.list", {});
      return listed.extensions.find((entry) => entry.name === "authoring")?.status;
    };
    expect(await statusOf()).toBe("disabled");
    await connection.request("settings.set", { key, value: true, scope: "user" });
    await Bun.sleep(300);
    // 단계 경계가 없으면 켜짐은 "enabling"으로 대기한다(다음 경계에서 적용). 꺼짐 상태로 남지 않는다
    expect(["enabling", "enabled"]).toContain(await statusOf());
    await connection.request("settings.set", { key, value: false, scope: "user" });
    await Bun.sleep(300);
    expect(await statusOf()).toBe("disabled");
    await connection.close();
    await host.close();
    home.dispose();
  },
  60_000,
);
