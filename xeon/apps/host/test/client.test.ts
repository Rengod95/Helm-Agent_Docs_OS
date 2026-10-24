import { expect, test } from "bun:test";
import { WireError, type WireResult } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createHostConnection, HostClientError } from "../src/client.ts";
import { flushMicrotasks } from "./fixtures/clock.ts";
import { manualTransport } from "./fixtures/manual-transport.ts";

const EMPTY_STATUS: WireResult<"host.status"> = {
  mode: "in-process",
  pid: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
};

test("request ids are r1, r2, … per connection and the params are sent as an object", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const first = connection.request("host.status", {});
  const second = connection.request("host.status", {});
  expect(manual.sent.map((message) => ("id" in message ? message.id : undefined))).toEqual([
    "r1",
    "r2",
  ]);
  expect(manual.sent[0]).toMatchObject({ jsonrpc: "2.0", method: "host.status", params: {} });
  manual.deliver({ jsonrpc: "2.0", id: "r2", result: EMPTY_STATUS });
  expect(await second).toEqual(EMPTY_STATUS);
  manual.deliver({ jsonrpc: "2.0", id: "r1", result: EMPTY_STATUS });
  expect(await first).toEqual(EMPTY_STATUS);
});

test("an error response rejects with a WireError carrying code, message and data", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const pending = connection.request("thread.create", {});
  manual.deliver({
    jsonrpc: "2.0",
    id: "r1",
    error: {
      code: 3002,
      message: "thread.locked",
      data: { kind: "thread.locked", retryable: true, details: { ownerKind: "cli" } },
    },
  });
  const error = await pending.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WireError);
  if (error instanceof WireError) {
    expect(error.code).toBe(3002);
    expect(error.data.retryable).toBe(true);
    expect(error.data.details).toEqual({ ownerKind: "cli" });
  }
});

test("server notifications reach their handlers until unsubscribed; other methods and unmatched responses are ignored", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const batches: unknown[] = [];
  const off = connection.onNotification("events.batch", (params) => {
    batches.push(params);
  });
  const batch = { sub: "s1", from: 0, to: 0, events: [], caughtUp: true };
  manual.deliver({ jsonrpc: "2.0", method: "events.batch", params: batch });
  manual.deliver({ jsonrpc: "2.0", method: "stream.chunk", params: {} });
  manual.deliver({ jsonrpc: "2.0", id: "r99", result: {} });
  manual.deliver({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "x", data: { kind: "k", retryable: false } },
  });
  manual.deliver("not an envelope");
  off();
  manual.deliver({ jsonrpc: "2.0", method: "events.batch", params: batch });
  expect(batches).toEqual([batch]);
});

test("a timeout rejects with kind timeout, sends $/cancelRequest and ignores the late response", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport, { defaultTimeoutMs: 1 });
  const error = await connection.request("thread.create", {}).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HostClientError);
  if (error instanceof HostClientError) expect(error.kind).toBe("timeout");
  expect(manual.sent.at(-1)).toMatchObject({ method: "$/cancelRequest", params: { id: "r1" } });
  manual.deliver({ jsonrpc: "2.0", id: "r1", result: {} });
  // 요청마다 준 시한이 기본 시한을 이긴다
  const slow = connection.request("thread.create", {}, { timeoutMs: 60_000 });
  const created: WireResult<"thread.create"> = {
    threadId: fixedIdFactory().next("thr"),
    position: { storeId: "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV", seq: 0 },
  };
  manual.deliver({ jsonrpc: "2.0", id: "r2", result: created });
  expect(await slow).toEqual(created);
});

test("aborting a signal sends $/cancelRequest and the request still ends with the server's answer", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const controller = new AbortController();
  const pending = connection.request("thread.create", {}, { signal: controller.signal });
  controller.abort();
  expect(manual.sent.at(-1)).toMatchObject({ method: "$/cancelRequest", params: { id: "r1" } });
  manual.deliver({
    jsonrpc: "2.0",
    id: "r1",
    error: {
      code: 5001,
      message: "request.cancelled",
      data: { kind: "request.cancelled", retryable: false },
    },
  });
  const error = await pending.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WireError);
});

test("an already aborted signal rejects without sending anything", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const error = await connection.request("thread.create", {}, { signal: AbortSignal.abort() }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HostClientError);
  if (error instanceof HostClientError) expect(error.kind).toBe("aborted");
  expect(manual.sent).toHaveLength(0);
});

test("a send failure rejects with kind sendFailed", async () => {
  const manual = manualTransport();
  manual.failSendsWith(new Error("pipe is gone"));
  const connection = createHostConnection(manual.transport);
  const error = await connection.request("thread.create", {}).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HostClientError);
  if (error instanceof HostClientError) {
    expect(error.kind).toBe("sendFailed");
    expect(error.message).toBe("pipe is gone");
  }
});

test("a close fails every pending request with the CloseInfo and later requests too; closed resolves", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  const pending = connection.request("thread.create", {});
  manual.closeRemote({ reason: "eof" });
  const error = await pending.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HostClientError);
  if (error instanceof HostClientError) {
    expect(error.kind).toBe("closed");
    expect(error.closeInfo).toEqual({ reason: "eof" });
  }
  expect(await connection.closed).toEqual({ reason: "eof" });
  const later = await connection.request("thread.create", {}).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(later).toBeInstanceOf(HostClientError);
});

test("close() closes the transport and waits for the close notice", async () => {
  const manual = manualTransport();
  const connection = createHostConnection(manual.transport);
  await connection.close();
  await flushMicrotasks();
  expect(await connection.closed).toEqual({ reason: "local" });
});
