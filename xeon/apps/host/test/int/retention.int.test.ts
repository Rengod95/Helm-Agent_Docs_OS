import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 보관 정리 (int): 엔진을 열 때 한 번 돈다(L1.persistence.spec §6.1). 수 상한을 넘은 오래된 thread가 다음 열기에서 지워진다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "opening the engine prunes the oldest threads above l1.persistence.retention.maxCount",
  async () => {
    const home = useEngineHome();
    const first = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const a = createHostConnection(first.client);
    await a.request("host.hello", HELLO_PARAMS);
    const ids = [
      (await a.request("thread.create", { title: "oldest" })).threadId,
      (await a.request("thread.create", { title: "middle" })).threadId,
      (await a.request("thread.create", { title: "newest" })).threadId,
    ];
    expect(ids).toHaveLength(3);
    await a.close();
    await first.close();

    writeUserSettings(home, { "l1.persistence.retention.maxCount": 1 });
    const second = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const b = createHostConnection(second.client);
    await b.request("host.hello", HELLO_PARAMS);
    const listed = await b.request("thread.list", {});
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0]?.title).toBe("newest");
    await b.close();
    await second.close();
    home.dispose();
  },
);
