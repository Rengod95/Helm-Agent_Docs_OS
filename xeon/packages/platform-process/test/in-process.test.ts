import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { checkEnvelope, type CloseInfo, type JsonRpcMessage } from "@xeon/contracts/wire";
import { createInProcessPair, createInProcessPairWith } from "../src/index.ts";
import { flushMicrotasks } from "./support/clock.ts";

const REQUEST: JsonRpcMessage = {
  jsonrpc: "2.0",
  id: "r1",
  method: "host.hello",
  params: { protocolVersion: "1.0.0" },
};

function collect(handlerSetup: (handler: (message: unknown) => void) => void): unknown[] {
  const received: unknown[] = [];
  handlerSetup((message) => {
    received.push(message);
  });
  return received;
}

describe("createInProcessPair", () => {
  test("delivers client messages to the server in order, never synchronously", async () => {
    const { client, server } = createInProcessPair();
    const received = collect((handler) => server.onMessage(handler));
    const second: JsonRpcMessage = { jsonrpc: "2.0", id: "r2", method: "host.status", params: {} };
    const first = client.send(REQUEST);
    const next = client.send(second);
    expect(received).toEqual([]);
    await Promise.all([first, next]);
    await flushMicrotasks();
    expect(received).toEqual([REQUEST, second]);
  });

  test("works in both directions and reports its kind", async () => {
    const { client, server } = createInProcessPair();
    expect(client.kind).toBe("in-process");
    expect(server.kind).toBe("in-process");
    const toClient = collect((handler) => client.onMessage(handler));
    const response: JsonRpcMessage = { jsonrpc: "2.0", id: "r1", result: {} };
    await server.send(response);
    await flushMicrotasks();
    expect(toClient).toEqual([response]);
  });

  test("keeps messages that arrive before the first handler and delivers them in order", async () => {
    const { client, server } = createInProcessPair();
    const second: JsonRpcMessage = { jsonrpc: "2.0", id: "r2", method: "host.status", params: {} };
    await client.send(REQUEST);
    await client.send(second);
    await flushMicrotasks();
    const received = collect((handler) => server.onMessage(handler));
    expect(received).toEqual([]);
    await flushMicrotasks();
    expect(received).toEqual([REQUEST, second]);
  });

  test("stops delivering to a handler after it unsubscribes", async () => {
    const { client, server } = createInProcessPair();
    const received: unknown[] = [];
    const off = server.onMessage((message) => {
      received.push(message);
    });
    await client.send(REQUEST);
    await flushMicrotasks();
    off();
    await client.send(REQUEST);
    await flushMicrotasks();
    expect(received).toHaveLength(1);
  });

  test("received messages go through the shared envelope check", async () => {
    const { client, server } = createInProcessPair();
    const received = collect((handler) => server.onMessage(handler));
    const badMethod: JsonRpcMessage = { jsonrpc: "2.0", id: "r2", method: "bad name", params: {} };
    await client.send(REQUEST);
    await client.send(badMethod);
    await flushMicrotasks();
    const checks = received.map((value) => checkEnvelope(value));
    expect(checks[0]?.ok).toBe(true);
    const second = checks[1];
    expect(second?.ok).toBe(false);
    if (second !== undefined && !second.ok) {
      expect(second.errorCode).toBe(-32600);
      expect(second.issue.code).toBe("methodName");
    }
  });
});

describe("serialization modes", () => {
  test("round-trip mode drops undefined fields and turns Dates into strings", async () => {
    const { client, server } = createInProcessPair();
    const received = collect((handler) => server.onMessage(handler));
    const when = new Date(1_767_571_200_000);
    await client.send({
      jsonrpc: "2.0",
      id: "r1",
      method: "host.hello",
      params: { gone: undefined, when, kept: 1 },
    });
    await flushMicrotasks();
    expect(received).toEqual([
      {
        jsonrpc: "2.0",
        id: "r1",
        method: "host.hello",
        params: { when: "2026-01-05T00:00:00.000Z", kept: 1 },
      },
    ]);
  });

  test("round-trip mode does not share object identity with the sender", async () => {
    const { client, server } = createInProcessPair();
    const received = collect((handler) => server.onMessage(handler));
    await client.send(REQUEST);
    await flushMicrotasks();
    expect(received[0]).toEqual(REQUEST);
    expect(received[0]).not.toBe(REQUEST);
  });

  test("round-trip mode rejects values JSON cannot carry with a Bug", async () => {
    const { client } = createInProcessPair();
    const rejection = await client
      .send({ jsonrpc: "2.0", id: "r1", method: "host.hello", params: { big: 10n } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(rejection).toBeInstanceOf(Bug);
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const second = await client
      .send({ jsonrpc: "2.0", id: "r2", method: "host.hello", params: circular })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(second).toBeInstanceOf(Bug);
  });

  test("freeze mode passes the same object, shallowly frozen", async () => {
    const { client, server } = createInProcessPairWith({ mode: "freeze" });
    const received = collect((handler) => server.onMessage(handler));
    const message: JsonRpcMessage = { jsonrpc: "2.0", id: "r1", method: "host.hello", params: {} };
    await client.send(message);
    await flushMicrotasks();
    expect(received[0]).toBe(message);
    expect(Object.isFrozen(message)).toBe(true);
  });
});

function recordClose(transport: {
  onClose(handler: (info: CloseInfo) => void): unknown;
}): CloseInfo[] {
  const infos: CloseInfo[] = [];
  transport.onClose((info) => {
    infos.push(info);
  });
  return infos;
}

describe("close", () => {
  test("closing one end notifies both ends once, with local and remote reasons", async () => {
    const { client, server } = createInProcessPair();
    const clientClosed = recordClose(client);
    const serverClosed = recordClose(server);
    await client.close("bye");
    await client.close();
    await server.close();
    expect(clientClosed).toEqual([{ reason: "local", message: "bye" }]);
    expect(serverClosed).toEqual([{ reason: "remote", message: "bye" }]);
  });

  test("close without a reason carries no message", async () => {
    const { client, server } = createInProcessPair();
    const serverClosed = recordClose(server);
    await client.close();
    expect(serverClosed).toEqual([{ reason: "remote" }]);
  });

  test("send after close is rejected on both ends", async () => {
    const { client, server } = createInProcessPair();
    await server.close();
    const fromClient = await client.send(REQUEST).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    const fromServer = await server.send(REQUEST).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(fromClient).toBeInstanceOf(Error);
    if (fromClient instanceof Error) expect(fromClient.message).toBe("transport closed");
    expect(fromServer).toBeInstanceOf(Error);
  });

  test("messages sent before close are delivered before the peer sees the close", async () => {
    const { client, server } = createInProcessPair();
    const events: string[] = [];
    server.onMessage(() => {
      events.push("message");
    });
    server.onClose(() => {
      events.push("close");
    });
    await client.send(REQUEST);
    await client.close();
    expect(events).toEqual(["message", "close"]);
  });

  test("a close handler added after closing still hears about it", async () => {
    const { client, server } = createInProcessPair();
    await client.close();
    const late = recordClose(server);
    await flushMicrotasks();
    expect(late).toEqual([{ reason: "remote" }]);
  });
});
