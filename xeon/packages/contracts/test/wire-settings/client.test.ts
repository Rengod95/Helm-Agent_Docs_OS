import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createHostConnection,
  createStdioTransport,
  HostClientError,
  WireError,
  WIRE_PROTOCOL_VERSION,
  type CloseInfo,
  type JsonRpcMessage,
  type Transport,
} from "../../src/wire-settings/wire/index.ts";

// F.wire-settings.spec §3.1: HostConnection의 런타임 중립 구현과 JSON Lines stdio 전송. Bun·Node API 없이 웹 스트림만 쓴다.

interface ManualTransport {
  readonly transport: Transport;
  readonly sent: JsonRpcMessage[];
  deliver(message: unknown): void;
  end(info: CloseInfo): void;
}

function manualTransport(): ManualTransport {
  const sent: JsonRpcMessage[] = [];
  const messageHandlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  const transport: Transport = {
    kind: "in-process",
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => void messageHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => void closeHandlers.delete(handler);
    },
    close: () => {
      for (const handler of closeHandlers) handler({ reason: "local" });
      return Promise.resolve();
    },
  };
  return {
    transport,
    sent,
    deliver: (message) => {
      for (const handler of messageHandlers) handler(message);
    },
    end: (info) => {
      for (const handler of closeHandlers) handler(info);
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const HELLO_RESULT = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  server: { name: "fake", version: "0.0.0" },
  storeId: "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  transport: "stdio",
  features: [],
  experimental: [],
};

describe("createHostConnection", () => {
  test("numbers requests r1, r2 and matches responses by id", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    const first = connection.request("host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "t", version: "0", kind: "other" },
    });
    expect(manual.sent[0]).toMatchObject({ id: "r1", method: "host.hello" });
    manual.deliver({ jsonrpc: "2.0", id: "r1", result: HELLO_RESULT });
    const storeId: string = (await first).storeId;
    expect(storeId).toBe(HELLO_RESULT.storeId);
  });

  test("a wire error response becomes a WireError", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    const pending = connection.request("settings.get", {});
    manual.deliver({
      jsonrpc: "2.0",
      id: "r1",
      error: {
        code: 1001,
        message: "hello first",
        data: { kind: "host.helloRequired", retryable: false },
      },
    });
    const caught = await pending.catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WireError);
  });

  test("a result that breaks the schema is invalidResponse", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    const pending = connection.request("settings.get", {});
    manual.deliver({ jsonrpc: "2.0", id: "r1", result: { settings: "nope" } });
    const caught = await pending.catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(HostClientError);
    expect(caught instanceof HostClientError && caught.kind).toBe("invalidResponse");
  });

  test("notify sends a client notification and no id", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    await connection.notify("$/connectionReset", {});
    expect(manual.sent).toEqual([{ jsonrpc: "2.0", method: "$/connectionReset", params: {} }]);
    await connection.notify("$/cancelRequest", { id: "r9" });
    expect(manual.sent[1]).toEqual({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "r9" },
    });
  });

  test("notify after the connection closed is a closed error", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    manual.end({ reason: "eof" });
    const caught = await connection
      .notify("$/connectionReset", {})
      .catch((error: unknown) => error);
    expect(caught instanceof HostClientError && caught.kind).toBe("closed");
  });

  test("pending requests fail with closed when the transport ends", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    const pending = connection.request("settings.get", {});
    manual.end({ reason: "eof" });
    const caught = await pending.catch((error: unknown) => error);
    expect(caught instanceof HostClientError && caught.kind).toBe("closed");
    expect((await connection.closed).reason).toBe("eof");
  });

  test("aborting a request sends $/cancelRequest", async () => {
    const manual = manualTransport();
    const connection = createHostConnection(manual.transport);
    const controller = new AbortController();
    const pending = connection.request("settings.get", {}, { signal: controller.signal });
    controller.abort();
    await tick();
    expect(manual.sent[1]).toMatchObject({ method: "$/cancelRequest", params: { id: "r1" } });
    manual.deliver({
      jsonrpc: "2.0",
      id: "r1",
      error: {
        code: 5001,
        message: "cancelled",
        data: { kind: "request.cancelled", retryable: false },
      },
    });
    const caught = await pending.catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WireError);
  });
});

function streamPair(): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  return { readable, writable };
}

describe("createStdioTransport (runtime neutral)", () => {
  test("a client and a server over web streams exchange framed messages and reset", async () => {
    const toServer = streamPair();
    const toClient = streamPair();
    const client = createStdioTransport({
      readable: toClient.readable,
      writable: toServer.writable,
    });
    const server = createStdioTransport({
      readable: toServer.readable,
      writable: toClient.writable,
    });
    const received: unknown[] = [];
    server.onMessage((message) => {
      received.push(message);
      if (typeof message === "object" && message !== null && Reflect.get(message, "id") === "r1") {
        void server.send({ jsonrpc: "2.0", id: "r1", result: HELLO_RESULT });
      }
    });
    const connection = createHostConnection(client);
    await connection.notify("$/connectionReset", {});
    const hello = await connection.request("host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "t", version: "0", kind: "other" },
    });
    expect(hello.server.name).toBe("fake");
    expect(received[0]).toEqual({ jsonrpc: "2.0", method: "$/connectionReset", params: {} });
    await connection.close();
  });

  test("a line over the frame limit is answered with frameTooLarge and the link stays usable", async () => {
    const toServer = streamPair();
    const toClient = streamPair();
    const small = createStdioTransport({
      readable: toServer.readable,
      writable: toClient.writable,
      maxFrameBytes: 100,
    });
    const replies: unknown[] = [];
    const clientSide = createStdioTransport({
      readable: toClient.readable,
      writable: toServer.writable,
    });
    clientSide.onMessage((message) => replies.push(message));
    const got: unknown[] = [];
    small.onMessage((message) => got.push(message));
    await clientSide.send({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "x".repeat(200) },
    });
    await clientSide.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "ok" } });
    await tick();
    expect(got).toEqual([{ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "ok" } }]);
    expect(replies[0]).toMatchObject({ id: null, error: { code: -32600 } });
  });
});

describe("runtime neutrality (A16)", () => {
  const DIR = resolve(import.meta.dir, "../../src/wire-settings/wire");
  for (const file of ["client.ts", "stdio.ts", "framing.ts"]) {
    test(`${file} uses no Bun or Node module`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source).not.toMatch(/from\s+"(node:|bun|fs|path|child_process)/);
      expect(source).not.toMatch(/\bBun\./);
      expect(source).not.toMatch(/\bBuffer\b/);
      expect(source).not.toMatch(/\bprocess\.(env|cwd|argv|nextTick|stdout|stdin|stderr|exit)\b/);
    });
  }
});
