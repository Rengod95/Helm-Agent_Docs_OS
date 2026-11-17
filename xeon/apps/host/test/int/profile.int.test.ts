import { expect, test } from "bun:test";
import type { ServerNotificationParams } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { settingReaderOf, startHost, stopHost } from "../../src/host-runtime.ts";
import { hostLimitsOf } from "../../src/assembly/settings-sources.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4: 프로필 파일을 한 연결이 저장하면 다른 연결의 profile.list에 보이고 `profile.changed`가 두 연결에 온다.
// 공통 묶음을 바꾸면 `commonChanged`가 참이다. 실제 엔진이 필요해 게이트가 막히면 건너뛴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 알림이 올 때까지 폴링
    await Bun.sleep(5);
  }
  expect(condition()).toBe(true);
}

realTest(
  "a profile one connection saves is listed by the other, and profile.changed reaches both with commonChanged false; a common save sets it",
  async () => {
    useEngineHome();
    const running = await startHost({ mode: "in-process", devChecks: true, defaultGroups: false });
    try {
      const attach = () => {
        const pair = createInProcessTransportFactory({ devChecks: true })();
        running.hub.serve(pair.server, {
          limits: hostLimitsOf(settingReaderOf(running.engine)),
          devChecks: true,
        });
        return createHostConnection(pair.client);
      };
      const first = attach();
      const second = attach();
      await first.request("host.hello", HELLO_PARAMS);
      await second.request("host.hello", HELLO_PARAMS);
      const seenFirst: ServerNotificationParams<"profile.changed">[] = [];
      const seenSecond: ServerNotificationParams<"profile.changed">[] = [];
      first.onNotification("profile.changed", (params) => {
        seenFirst.push(params);
      });
      second.onNotification("profile.changed", (params) => {
        seenSecond.push(params);
      });

      const profile = {
        id: "review",
        title: "Review",
        plugins: [],
        settings: [],
        startDrive: null,
      };
      const before = await second.request("profile.list", {});
      expect(before.profiles.map((item) => item.id)).toEqual(["default"]);
      const created = await first.request("profile.put", { profile, baseRev: null });
      expect(created.profile.rev).toBe(1);
      await until(() => seenFirst.length === 1 && seenSecond.length === 1);
      expect(seenSecond[0]).toMatchObject({ ids: ["review"], commonChanged: false });
      expect((await second.request("profile.list", {})).profiles.map((item) => item.id)).toEqual([
        "default",
        "review",
      ]);

      await first.request("profile.common.put", {
        common: { plugins: [], settings: [] },
        baseRev: 0,
      });
      await until(() => seenSecond.length === 2);
      expect(seenSecond[1]).toMatchObject({ commonChanged: true });
    } finally {
      await stopHost(running);
    }
  },
);
