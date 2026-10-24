import { expect, test } from "bun:test";
import { attemptAsync } from "@xeon/contracts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { WireError, type HostConnection, type WireHandlers } from "@xeon/contracts/wire";
import { HostClientError } from "../src/client.ts";
import { createFakeHost } from "./fixtures/fake-host.ts";
import { isRecord, rawClient } from "./fixtures/raw-client.ts";
import { HELLO_PARAMS } from "./fixtures/wire-client.ts";

const SOME_THREAD = fixedIdFactory().next("thr");

const withId = (id: string) => (message: unknown) => isRecord(message) && message["id"] === id;

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

async function ready(connection: HostConnection): Promise<void> {
  await connection.request("host.hello", HELLO_PARAMS);
}

test("host-hello-gating: requests before hello are 1001, a second hello is 1002, another major is 1003", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const early = await wireErrorOf(
    connection.request("turn.start", { threadId: SOME_THREAD, input: "hi" }),
  );
  expect(early.code).toBe(1001);

  const refused = await wireErrorOf(
    connection.request("host.hello", { ...HELLO_PARAMS, protocolVersion: "9.0.0" }),
  );
  expect(refused.code).toBe(1003);
  expect(refused.data.details).toMatchObject({ clientVersion: "9.0.0" });
  // 1003 뒤에도 연결은 awaitingHello에 남는다
  expect((await wireErrorOf(connection.request("settings.get", {}))).code).toBe(1001);

  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.server.name).toBe("xeon");
  expect(hello.transport).toBe("in-process");
  const duplicate = await wireErrorOf(connection.request("host.hello", HELLO_PARAMS));
  expect(duplicate.code).toBe(1002);
  await connection.close();
});

test("handler-throw-internal-error: an unknown exception is -32603 with no original text and a logged traceId", async () => {
  const host = createFakeHost({
    override: (table): WireHandlers => ({
      ...table,
      "settings.get": () => Promise.reject(new Error("secret detail")),
    }),
  });
  const { client, connection } = host.connect();
  const seen: string[] = [];
  client.onMessage((message) => {
    seen.push(JSON.stringify(message));
  });
  await ready(connection);
  const error = await wireErrorOf(connection.request("settings.get", {}));
  expect(error.code).toBe(-32603);
  expect(error.message).toBe("Internal error");
  expect(error.data.kind).toBe("internal");
  const traceId = error.data.traceId;
  expect(traceId).toBeDefined();
  expect(seen.join("\n")).not.toContain("secret detail");
  const logged = host.fake.log.errors.find((entry) => entry.message === "handler.threw");
  expect(logged?.fields["traceId"]).toBe(traceId);
  expect(logged?.fields["message"]).toBe("secret detail");
  await connection.close();
});

test("handler-throw-internal-error: a WireError thrown by a handler keeps its code and kind", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await ready(connection);
  const error = await wireErrorOf(
    connection.request("settings.get", { keys: ["l1.nope.missing"] }),
  );
  expect(error.code).toBe(3101);
  expect(error.data.kind).toBe("settings.unknownKey");
  expect(error.data.details).toEqual({ key: "l1.nope.missing" });
  await connection.close();
});

test("cancel-request: $/cancelRequest ends an in-flight request with 5001, a cancel after the response is ignored", async () => {
  const host = createFakeHost({
    override: (table): WireHandlers => ({
      ...table,
      "thread.create": (_params, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            reject(new Error("aborted by the test"));
          });
        }),
    }),
  });
  const { connection } = host.connect();
  await ready(connection);
  const controller = new AbortController();
  const pending = wireErrorOf(
    connection.request("thread.create", {}, { signal: controller.signal }),
  );
  controller.abort();
  const cancelled = await pending;
  expect(cancelled.code).toBe(5001);
  expect(cancelled.data.kind).toBe("request.cancelled");

  // 이미 응답한 id, 모르는 id의 취소는 무시한다
  const { client, connection: second } = host.connect();
  const raw = rawClient(client);
  await second.request("host.hello", HELLO_PARAMS);
  await raw.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } });
  await raw.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "nope" } });
  const settings = await second.request("settings.get", {});
  expect(settings.settings.length).toBeGreaterThan(0);
  await second.close();
  await connection.close();
});

test("cancel-request: a cancel before hello is ignored", async () => {
  const host = createFakeHost();
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await raw.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } });
  await ready(connection);
  await connection.close();
});

test("connection-reset: a new page can say hello again, its old requests end without a reply, its subscription is dropped", async () => {
  const aborted: string[] = [];
  const host = createFakeHost({
    override: (table): WireHandlers => ({
      ...table,
      "thread.create": (_params, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            aborted.push(context.rpcId);
            reject(new Error("aborted by the test"));
          });
        }),
    }),
  });
  const { client } = host.connect();
  const raw = rawClient(client);
  const count = (id: string): number => raw.received.filter((e) => withId(id)(e.message)).length;

  await raw.send({ jsonrpc: "2.0", id: "r1", method: "host.hello", params: HELLO_PARAMS });
  await raw.response("r1");
  await raw.send({
    jsonrpc: "2.0",
    id: "r2",
    method: "events.subscribe",
    params: { from: "head" },
  });
  await raw.response("r2");
  await raw.send({ jsonrpc: "2.0", id: "r3", method: "thread.create", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const state = host.hub.connections()[0];
  expect(state?.subs.size).toBe(1);

  await raw.send({ jsonrpc: "2.0", method: "$/connectionReset", params: {} });
  // 새 화면은 같은 연결에서 id를 r1부터 다시 쓴다
  await raw.send({ jsonrpc: "2.0", id: "r1", method: "host.hello", params: HELLO_PARAMS });
  await raw.waitFor(() => count("r1") === 2);
  await raw.send({ jsonrpc: "2.0", id: "r3", method: "settings.get", params: {} });
  await raw.response("r3");
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(aborted).toEqual(["r3"]);
  // 이전 화면의 r3(thread.create)는 응답 없이 끝났다: r3 응답은 새 화면의 것 하나뿐이다
  expect(count("r3")).toBe(1);
  expect(raw.received.find((e) => withId("r3")(e.message))?.message).toMatchObject({
    result: { settings: expect.any(Array) },
  });
  expect(raw.received.findLast((e) => withId("r1")(e.message))?.message).toMatchObject({
    result: { protocolVersion: expect.any(String) },
  });
  expect(state?.subs.size).toBe(0);
  expect(state?.phase).toBe("ready");
  await raw.close();
});

test("connection-reset: a reset before hello is ignored", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.notify("$/connectionReset", {});
  await ready(connection);
  await connection.close();
});

test("not-implemented-hidden: an unimplemented method is -32601 and is not in the hello features", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  expect(names).toContain("thread.create");
  expect(names).toContain("turn.start");
  expect(names).toContain("events.subscribe");
  expect(names).toContain("settings.get");
  expect(names).toContain("host.hello");
  expect(names).toContain("events.batch");
  expect(names).toContain("stream.chunk");
  expect(names).toContain("$/cancelRequest");
  expect(names).not.toContain("thread.list");
  expect(names).not.toContain("host.status");
  expect(hello.features.every((feature) => feature.status === "active")).toBe(true);

  const missing = await wireErrorOf(connection.request("thread.list", {}));
  expect(missing.code).toBe(-32601);
  expect(missing.data.details).toEqual({ method: "thread.list" });
  await connection.close();
});

test("send-queue-overflow-closes: a queue over the limit closes the connection with sendQueueOverflow", async () => {
  const host = createFakeHost({ limits: { sendQueueMaxBytes: 100 } });
  const { served, connection } = host.connect((server) => ({
    ...server,
    // 아무것도 내보내지 못하는 느린 전송
    send: () => new Promise<void>(() => undefined),
  }));
  const hello = attemptAsync(() => connection.request("host.hello", HELLO_PARAMS));
  const info = await served.closed;
  // 느린 전송이 닫히면 응답을 못 받은 요청은 오류로 끝난다
  expect((await hello).ok).toBe(false);
  expect(info).toEqual({ reason: "error", message: "sendQueueOverflow" });
  expect(host.hub.size).toBe(0);
  expect(
    host.fake.log.errors.some((entry) => entry.message === "connection.send_queue_overflow"),
  ).toBe(true);
});

test("a closed connection rejects pending and new requests with a HostClientError", async () => {
  const host = createFakeHost({
    override: (table): WireHandlers => ({
      ...table,
      "thread.create": () => new Promise(() => undefined),
    }),
  });
  const { served, connection } = host.connect();
  await ready(connection);
  const pending = connection.request("thread.create", {});
  await served.close("test");
  const closed = await pending.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(closed).toBeInstanceOf(HostClientError);
  if (closed instanceof HostClientError) {
    expect(closed.kind).toBe("closed");
    expect(closed.closeInfo?.reason).toBe("remote");
  }
  const after = await connection.request("settings.get", {}).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(after).toBeInstanceOf(HostClientError);
  expect((await connection.closed).reason).toBe("remote");
});

test("beginShutdown makes new requests 5002 with a retry delay while open connections stay open", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await ready(connection);
  host.hub.beginShutdown();
  const error = await wireErrorOf(connection.request("settings.get", {}));
  expect(error.code).toBe(5002);
  expect(error.data.retryAfterMs).toBe(1000);
  expect(error.data.details).toEqual({ retryAfterMs: 1000 });
  await host.hub.closeAll("shutdown");
  expect(host.hub.size).toBe(0);
});

test("the hub reports its size to listeners and drops a connection's state when it closes", async () => {
  const host = createFakeHost();
  const sizes: number[] = [];
  host.hub.onSizeChange((size) => {
    sizes.push(size);
  });
  const first = host.connect();
  const second = host.connect();
  expect(host.hub.size).toBe(2);
  await first.served.close();
  await second.served.close();
  expect(sizes).toEqual([1, 2, 1, 0]);
  expect(host.hub.state(first.served.id)).toBeUndefined();
});

test("a duplicate in-flight request id is -32600", async () => {
  const host = createFakeHost({
    override: (table): WireHandlers => ({
      ...table,
      "thread.create": (_params, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            reject(new Error("closed"));
          });
        }),
    }),
  });
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  const frame = { jsonrpc: "2.0", id: "dup", method: "thread.create", params: {} };
  await raw.send(frame);
  await raw.send(frame);
  const response = await raw.response(null);
  expect(response.message).toMatchObject({ error: { code: -32600 } });
  await connection.close();
});
