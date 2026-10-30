import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { fakeHostedSearch } from "../fixtures/web-search.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import {
  BUILTIN_WRAPPER_PROVIDER_ID,
  DEFAULT_WEB_SETTINGS,
  describeWebSettings,
} from "@xeon/cap-web";

// M3-REQ-96 (int): 실제 엔진에서 `web.providers`. cap-web이 올라와 provider 목록을 내고, 호스트된 검색이 있으면 내장 래퍼 행이 든다.
// 설정 값은 사용자 설정 파일이 비었을 때 기본값이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "web.providers lists the built-in search wrapper when a hosted search exists, with the default settings",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      webPorts: { hostedSearch: fakeHostedSearch().port },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const answer = await connection.request("web.providers", {});
      expect(answer.settings).toEqual(describeWebSettings(DEFAULT_WEB_SETTINGS));
      expect(answer.providers.find((row) => row.id === BUILTIN_WRAPPER_PROVIDER_ID)).toMatchObject({
        capability: "web.search",
        origin: "builtin",
      });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
);
