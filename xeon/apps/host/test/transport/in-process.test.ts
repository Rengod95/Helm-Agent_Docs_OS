import { expect, test } from "bun:test";
import type { CloseInfo, JsonRpcMessage } from "@xeon/contracts/wire";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { flushMicrotasks } from "../fixtures/clock.ts";
import { rejectionOf } from "../fixtures/rejection.ts";

function note(index: number): JsonRpcMessage {
  return { jsonrpc: "2.0", method: "events.batch", params: { index } };
}

test("messages arrive in the order they were sent and only after the sender yields", async () => {
  const { client, server } = createInProcessTransportFactory()();
  const seen: unknown[] = [];
  server.onMessage((message) => {
    seen.push(message);
  });
  const sends = [client.send(note(1)), client.send(note(2)), client.send(note(3))];
  expect(seen).toHaveLength(0);
  await Promise.all(sends);
  await flushMicrotasks();
  expect(seen).toEqual([note(1), note(2), note(3)]);
});

test("messages that arrive before any handler is attached are kept for the first handler", async () => {
  const { client, server } = createInProcessTransportFactory()();
  await client.send(note(1));
  await flushMicrotasks();
  const seen: unknown[] = [];
  server.onMessage((message) => {
    seen.push(message);
  });
  await flushMicrotasks();
  expect(seen).toEqual([note(1)]);
});

test("devChecks delivers a JSON round-tripped copy, so values JSON cannot carry are dropped here first", async () => {
  const { client, server } = createInProcessTransportFactory({ devChecks: true })();
  const seen: unknown[] = [];
  server.onMessage((message) => {
    seen.push(message);
  });
  const original: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: "events.batch",
    params: { kept: 1, dropped: undefined },
  };
  await client.send(original);
  await flushMicrotasks();
  expect(seen).toEqual([{ jsonrpc: "2.0", method: "events.batch", params: { kept: 1 } }]);
  expect(seen[0]).not.toBe(original);
});

test("without devChecks the message object is passed as it is", async () => {
  const { client, server } = createInProcessTransportFactory()();
  const seen: unknown[] = [];
  server.onMessage((message) => {
    seen.push(message);
  });
  const original = note(1);
  await client.send(original);
  await flushMicrotasks();
  expect(seen[0]).toBe(original);
});

test("closing one side delivers what was already sent, then closes both sides with local and remote", async () => {
  const { client, server } = createInProcessTransportFactory()();
  const seen: unknown[] = [];
  const closes: { side: string; info: CloseInfo }[] = [];
  server.onMessage((message) => {
    seen.push(message);
  });
  client.onClose((info) => {
    closes.push({ side: "client", info });
  });
  server.onClose((info) => {
    closes.push({ side: "server", info });
  });
  await client.send(note(1));
  await client.close("bye");
  await flushMicrotasks();
  expect(seen).toEqual([note(1)]);
  expect(closes).toEqual([
    { side: "client", info: { reason: "local", message: "bye" } },
    { side: "server", info: { reason: "remote" } },
  ]);
  expect(String(await rejectionOf(client.send(note(2))))).toContain("closed");
  // 두 번 닫아도 한 번만 알린다
  await client.close();
  await flushMicrotasks();
  expect(closes).toHaveLength(2);
});

test("a close handler attached after the close still hears about it", async () => {
  const { client } = createInProcessTransportFactory()();
  await client.close();
  const seen: CloseInfo[] = [];
  client.onClose((info) => {
    seen.push(info);
  });
  await flushMicrotasks();
  expect(seen).toEqual([{ reason: "local" }]);
});

test("each factory call makes an independent pair", async () => {
  const factory = createInProcessTransportFactory();
  const first = factory();
  const second = factory();
  const seen: unknown[] = [];
  second.server.onMessage((message) => {
    seen.push(message);
  });
  await first.client.send(note(1));
  await flushMicrotasks();
  expect(seen).toHaveLength(0);
});
