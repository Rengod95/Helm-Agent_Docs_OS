import { expect, test } from "bun:test";
import type { ShutdownReason } from "@xeon/contracts/services";
import type { Transport } from "@xeon/contracts/wire";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HS-31, HS-34, F wire host.shutdown. 가짜 엔진의 종료 협조 창구는 실제 ProcessShutdown(L0.process)이고 시간은 수동 스케줄러다.

async function opened(options: Parameters<typeof createFakeHost>[0]) {
  const host = createFakeHost(options);
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection, served };
}

test("host.shutdown is not offered without a lifecycle (in-process): -32601 and not in the hello features", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).not.toContain("host.shutdown");
  const refused = await rejectionOf(connection.request("host.shutdown", { reason: "user" }));
  expect(refused).toMatchObject({ code: -32601 });
  await connection.close();
});

test("host.shutdown runs the participants, newest first, before it answers accepted; the host is told after the answer", async () => {
  const order: string[] = [];
  const { host, connection } = await opened({
    lifecycle: {
      stopRequested: (reason) => {
        order.push(`lifecycle:${reason}`);
      },
    },
  });
  const slow = Promise.withResolvers<void>();
  host.fake.engine.shutdown.onShutdown("first", () => {
    order.push("first");
    return Promise.resolve();
  });
  host.fake.engine.shutdown.onShutdown("second", async () => {
    order.push("second:start");
    await slow.promise;
    order.push("second:done");
  });
  const answered = connection.request("host.shutdown", { reason: "client_exit" }).then((result) => {
    order.push("answered");
    return result;
  });
  await settleUntil(() => order.includes("second:start"));
  // 참여자가 끝나기 전에는 응답도 수명 신호도 없다
  expect(order).toEqual(["second:start"]);
  slow.resolve();
  expect(await answered).toEqual({ accepted: true });
  expect(order).toEqual([
    "second:start",
    "second:done",
    "first",
    "lifecycle:shutdown_request",
    "answered",
  ]);
  await connection.close();
});

async function reasonSeenFor(requested: "client_exit" | "version_replace" | "user") {
  const seen: ShutdownReason[] = [];
  const { host, connection } = await opened({ lifecycle: { stopRequested: () => undefined } });
  host.fake.engine.shutdown.onShutdown("probe", (reason) => {
    seen.push(reason);
    return Promise.resolve();
  });
  await connection.request("host.shutdown", { reason: requested });
  await connection.close();
  return seen;
}

test("version_replace is passed on as its own reason; client_exit and user are a plain shutdown request", async () => {
  const seen = await Promise.all([
    reasonSeenFor("version_replace"),
    reasonSeenFor("client_exit"),
    reasonSeenFor("user"),
  ]);
  expect(seen).toEqual([["version_replace"], ["shutdown_request"], ["shutdown_request"]]);
});

test("a participant that never finishes ends the process with exit 1 at the deadline and sends no answer", async () => {
  const stopped: string[] = [];
  const { host, connection } = await opened({
    lifecycle: {
      stopRequested: (reason) => {
        stopped.push(reason);
      },
    },
  });
  host.fake.engine.shutdown.onShutdown("stuck", () => new Promise<void>(() => undefined));
  const answered = connection.request("host.shutdown", { reason: "user" });
  const settled = answered.then(
    () => "answered",
    () => "failed",
  );
  await flushMicrotasks();
  // l0.process.shutdown.timeoutMs(3000) 뒤 창구가 exit(1)을 부른다. 대역의 exit는 던지므로 타이머 호출에서 나온다
  let thrown: unknown;
  try {
    host.fake.scheduler.advance(3000);
  } catch (caught) {
    thrown = caught;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(host.fake.exits).toEqual([1]);
  expect(stopped).toEqual([]);
  await connection.close();
  expect(await settled).toBe("failed");
});

test("a second host.shutdown joins the first request and a request after the host began stopping is 5002", async () => {
  const { host, connection } = await opened({ lifecycle: { stopRequested: () => undefined } });
  const runs: string[] = [];
  host.fake.engine.shutdown.onShutdown("once", () => {
    runs.push("run");
    return Promise.resolve();
  });
  const [first, second] = await Promise.all([
    connection.request("host.shutdown", { reason: "user" }),
    connection.request("host.shutdown", { reason: "user" }),
  ]);
  expect([first, second]).toEqual([{ accepted: true }, { accepted: true }]);
  expect(runs).toEqual(["run"]);
  host.hub.beginShutdown();
  const refused = await rejectionOf(connection.request("host.shutdown", { reason: "user" }));
  expect(refused).toMatchObject({ code: 5002 });
  await connection.close();
});

/** 켜 두면 서버가 보내는 메시지를 붙잡아 두는 전송 */
function gated(): {
  readonly wrap: (server: Transport) => Transport;
  hold(): void;
  release(): void;
} {
  const state: { held: boolean; waiters: (() => void)[] } = { held: false, waiters: [] };
  return {
    wrap: (server) => ({
      ...server,
      async send(message) {
        if (state.held) await new Promise<void>((resolve) => state.waiters.push(resolve));
        await server.send(message);
      },
    }),
    hold() {
      state.held = true;
    },
    release() {
      state.held = false;
      for (const resolve of state.waiters.splice(0)) resolve();
    },
  };
}

test("closeAll waits for the last response to leave before it closes, up to one second", async () => {
  const slow = gated();
  const host = createFakeHost();
  const { connection } = host.connect(slow.wrap);
  await connection.request("host.hello", HELLO_PARAMS);
  slow.hold();
  const pending = connection.request("settings.get", { keys: ["l1.loop.maxSteps"] });
  await flushMicrotasks();
  let closed = false;
  const closing = host.hub.closeAll("shutdown").then(() => {
    closed = true;
    return undefined;
  });
  await flushMicrotasks();
  expect(closed).toBe(false);
  slow.release();
  // 붙잡힌 응답이 나간 뒤에야 닫히고, 클라이언트는 그 응답을 받는다
  expect((await pending).settings).toHaveLength(1);
  await closing;
  expect(closed).toBe(true);
});

test("closeAll gives up on a peer that does not read after one second", async () => {
  const stuck = gated();
  const host = createFakeHost();
  const { connection } = host.connect(stuck.wrap);
  await connection.request("host.hello", HELLO_PARAMS);
  stuck.hold();
  const unanswered = connection.request("settings.get", {}).then(
    () => undefined,
    () => undefined,
  );
  await flushMicrotasks();
  let closed = false;
  const closing = host.hub.closeAll("shutdown").then(() => {
    closed = true;
    return undefined;
  });
  await flushMicrotasks();
  expect(closed).toBe(false);
  host.fake.scheduler.advance(1000);
  stuck.release();
  await closing;
  expect(closed).toBe(true);
  await unanswered;
});
