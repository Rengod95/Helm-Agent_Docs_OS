import { expect, test } from "bun:test";
import { startInProcessHost } from "../../src/main.ts";
import { createHostConnection } from "../../src/client.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.3, §4.1.9·§4.1.10: 플러그인별 켜기·끄기 스위치는 설정과 wire에 없다. 켜짐은 프로필에서 계산한다.
// `ext.<이름>.enabled`는 관리 범위만 받는다(관리자가 잠그는 용도). 사용자 범위 쓰기는 `settings.scopeNotAllowed`로 거절한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a plugin switch is not a user setting: ext.<name>.enabled is refused in the user scope",
  async () => {
    useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const refused = await connection
      .request("settings.set", {
        key: "ext.cap-web.enabled",
        value: false,
        scope: "user",
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toMatchObject({ data: { kind: "settings.scopeNotAllowed" } });
  },
);
