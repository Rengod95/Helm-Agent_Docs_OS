import { afterAll, describe, expect, test } from "bun:test";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, startStdioHost, type InProcessHost } from "../../src/main.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { stdioStreams } from "../fixtures/stdio-pair.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AH-08, HS-23~HS-29, HS-16 (int): 같은 저장소를 연 호스트 둘이 실제 OS 잠금과 sys_leases로 쓰기 소유를 다툰다.
// 호스트 둘이 한 프로세스 안에 있어도 잠금은 열린 파일마다 따로라 서로를 막는다. 자식 프로세스를 띄우지 않는다(DR-07).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

async function connect(host: InProcessHost): Promise<HostConnection> {
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function lockedError(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw new Error("expected a WireError");
}

describe("thread-locked-alternatives", () => {
  realTest(
    "only one host owns a thread: the other gets 3002 with the owner kind and observe/fork",
    async () => {
      const owner = await startInProcessHost({ devChecks: true });
      const other = await startInProcessHost({ devChecks: true });
      const a = await connect(owner);
      const b = await connect(other);
      const created = await a.request("thread.create", { title: "contested" });

      const open = await lockedError(
        b.request("thread.open", { threadId: created.threadId, mode: "write" }),
      );
      expect(open.code).toBe(3002);
      expect(open.data.details).toEqual({ ownerKind: "cli", options: ["observe", "fork"] });
      // turn.start의 암묵 획득도 같은 결과다(HS-28)
      const implicit = await lockedError(
        b.request("turn.start", { threadId: created.threadId, input: "hi" }),
      );
      expect(implicit.code).toBe(3002);
      expect(implicit.data.details).toEqual({ ownerKind: "cli", options: ["observe", "fork"] });

      // 관찰은 잠금 없이 열린다
      const observed = await b.request("thread.open", {
        threadId: created.threadId,
        mode: "observe",
      });
      expect(observed.role).toBe("observer");
      expect(observed.position.seq).toBeGreaterThan(0);

      await a.close();
      await b.close();
      await other.close();
      await owner.close();
    },
  );

  realTest(
    "the owner kind in the refusal follows how the owner was started (stdio is app)",
    async () => {
      const streams = stdioStreams();
      const exit = startStdioHost({
        readable: streams.clientToServer.readable,
        writable: streams.serverToClient.writable,
        assemble: { devChecks: true },
        handleSignals: false,
      });
      const appClient = createHostConnection(
        createStdioTransport({
          readable: streams.serverToClient.readable,
          writable: streams.clientToServer.writable,
        }),
      );
      await appClient.request("host.hello", HELLO_PARAMS);
      const created = await appClient.request("thread.create", {});

      const cli = await startInProcessHost({ devChecks: true });
      const cliClient = await connect(cli);
      const refused = await lockedError(
        cliClient.request("thread.open", { threadId: created.threadId, mode: "write" }),
      );
      expect(refused.data.details).toMatchObject({ ownerKind: "app" });

      await cliClient.close();
      await cli.close();
      await appClient.close();
      expect((await exit).code).toBe(0);
    },
  );

  realTest(
    "a lock released by the owner can be taken by the other host (the kernel frees it with the process)",
    async () => {
      const owner = await startInProcessHost({ devChecks: true });
      const a = await connect(owner);
      const created = await a.request("thread.create", {});
      await a.close();
      await owner.close();

      const next = await startInProcessHost({ devChecks: true });
      const b = await connect(next);
      const opened = await b.request("thread.open", { threadId: created.threadId, mode: "write" });
      expect(opened.role).toBe("owner");
      await b.close();
      await next.close();
    },
  );
});

describe("observe-poll-follows-commits", () => {
  realTest(
    "an observer on another host receives the owner's commits through the 250 ms poll, once and in order",
    async () => {
      const owner = await startInProcessHost({ devChecks: true });
      const observer = await startInProcessHost({ devChecks: true });
      const a = await connect(owner);
      const b = await connect(observer);
      const created = await a.request("thread.create", { title: "watched" });
      await b.request("thread.open", { threadId: created.threadId, mode: "observe" });
      const filter = { threadIds: [created.threadId] };
      const observed = collectEvents(b);
      await b.request("events.subscribe", { from: "head", filter });
      const owned = collectEvents(a);
      await a.request("events.subscribe", { from: "head", filter });

      await a.request("turn.start", { threadId: created.threadId, input: "hello" });
      const started = await observed.waitFor((event) => event.kind === "turn.started");
      expect(started.threadId).toBe(created.threadId);
      // 소유자가 본 마지막 seq까지 관찰자도 받는다
      const lastOwned = Math.max(...owned.events.map((event) => event.seq));
      await observed.waitFor((event) => event.seq >= lastOwned);

      // 받은 seq는 소유자가 본 것과 같고, 빠짐없이 한 번씩이며 오름차순이다
      const seen = observed.events.map((event) => event.seq).filter((seq) => seq <= lastOwned);
      expect(seen).toEqual(
        owned.events.map((event) => event.seq).filter((seq) => seq <= lastOwned),
      );
      expect(seen).toEqual(seen.toSorted((x, y) => x - y));
      expect(new Set(seen).size).toBe(seen.length);

      await a.close();
      await b.close();
      await observer.close();
      await owner.close();
    },
  );
});
