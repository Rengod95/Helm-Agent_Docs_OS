import { afterAll, expect, test } from "bun:test";
import { WireError } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M2 마감 재검토 결함 10 (int): 아무도 쥐지 않은 thread에서 thread.rename이 빌린 잠금을, 같은 순간의 turn.start가 이어받으면 rename이 놓지 않는다.
// 놓아 버리면 turn이 도는 thread를 다른 호스트가 쓰기로 열 수 있다(쓰기 소유자 둘). 실제 잠금과 sys_leases 위에서 다른 호스트의 열기로 견준다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
writeUserSettings(home, TAPE_SETTINGS);
afterAll(() => {
  home.dispose();
});

realTest(
  "a rename and a turn.start at once on a thread nobody holds: the turn's owner keeps the lock, so another host cannot open the thread for writing",
  async () => {
    const first = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const setup = createHostConnection(first.client);
    await setup.request("host.hello", HELLO_PARAMS);
    const created = await setup.request("thread.create", {});
    await setup.close();
    await first.close();

    const owner = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("rename-owner", "답"),
    });
    const connection = createHostConnection(owner.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const other = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const outsider = createHostConnection(other.client);
    await outsider.request("host.hello", HELLO_PARAMS);
    try {
      const [renamed, started] = await Promise.all([
        connection.request("thread.rename", { threadId: created.threadId, title: "새 제목" }),
        connection.request("turn.start", { threadId: created.threadId, input: "질문" }),
      ]);
      expect(renamed.position.seq).toBeGreaterThan(0);
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        20_000,
      );
      const caught = await rejectionOf(
        outsider.request("thread.open", { threadId: created.threadId, mode: "write" }),
      );
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) expect(caught.code).toBe(3002);
    } finally {
      await outsider.close();
      await other.close();
      await connection.close();
      await owner.close();
    }
  },
  60_000,
);

realTest(
  "a rename on a thread nobody holds gives the lock back, so another host can open it afterwards",
  async () => {
    const first = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(first.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const created = await connection.request("thread.create", {});
    await connection.request("thread.close", { threadId: created.threadId });
    await connection.close();
    await first.close();

    const renamer = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const renaming = createHostConnection(renamer.client);
    await renaming.request("host.hello", HELLO_PARAMS);
    await renaming.request("thread.rename", { threadId: created.threadId, title: "빌린 뒤" });

    const next = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const opening = createHostConnection(next.client);
    await opening.request("host.hello", HELLO_PARAMS);
    try {
      const opened = await opening.request("thread.open", {
        threadId: created.threadId,
        mode: "write",
      });
      expect(opened.role).toBe("owner");
    } finally {
      await opening.close();
      await next.close();
      await renaming.close();
      await renamer.close();
    }
  },
  60_000,
);
