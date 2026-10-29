import { expect, test } from "bun:test";
import type { ServerNotificationParams } from "@xeon/contracts/wire";
import { hostLimitsOf } from "../../src/assembly/settings-sources.ts";
import { createHostConnection } from "../../src/client.ts";
import { settingReaderOf, startHost, stopHost } from "../../src/host-runtime.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-16 (int): 실제 엔진에서 turn이 끝나면 연결된 클라이언트 두 개가 `notify.delivered`를 한 번씩 받고, `notify.list`가 같은 알림을 준다.
// 두 번째 연결은 `startInProcessHost`가 주지 않아 같은 호스트에 전송 쌍을 하나 더 붙인다. OS 알림은 provider none으로 끈다(실제 도구를 띄우지 않는다).

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
  "a completed turn reaches both clients once as notify.delivered, and notify.list returns the same notice",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const running = await startHost({
      mode: "in-process",
      devChecks: true,
      defaultGroups: false,
      osNotifier: null,
      buildModels: callingModels("notify", []),
    });
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
    const seenFirst: ServerNotificationParams<"notify.delivered">[] = [];
    const seenSecond: ServerNotificationParams<"notify.delivered">[] = [];
    first.onNotification("notify.delivered", (params) => {
      seenFirst.push(params);
    });
    second.onNotification("notify.delivered", (params) => {
      seenSecond.push(params);
    });
    const collector = collectEvents(first);
    await first.request("events.subscribe", { from: "head" });

    const created = await first.request("thread.create", {});
    await first.request("turn.start", { threadId: created.threadId, input: "hi" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    await until(() => seenFirst.length >= 1 && seenSecond.length >= 1);
    // 같은 턴의 알림이 한 번 더 오면 여기서 보인다
    await Bun.sleep(20);

    expect(seenFirst.map((params) => params.notice.kind)).toEqual(["completed"]);
    expect(seenSecond.map((params) => params.notice.kind)).toEqual(["completed"]);
    const [delivered] = seenFirst;
    expect(delivered?.threadId).toBe(created.threadId);
    expect(delivered?.notice.title).toBe("작업이 끝났다");
    expect(delivered?.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(seenSecond[0]).toEqual(delivered);

    // notify.list는 같은 알림(seq, 제목, 본문까지)을 돌려준다
    const listed = await second.request("notify.list", { afterSeq: 0 });
    expect(listed.notices).toEqual(seenFirst.map((params) => params.notice));
    expect(listed.notices.map((notice) => notice.title)).toEqual(["작업이 끝났다"]);

    await first.close();
    await second.close();
    await stopHost(running);
    home.dispose();
  },
  30_000,
);
