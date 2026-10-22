import { describe, expect, test } from "bun:test";
import { parseJson } from "@xeon/contracts";
import type { CloseInfo, JsonRpcMessage, Transport } from "@xeon/contracts/wire";
import { createStdioTransport, createStdioTransportWith } from "../src/index.ts";
import { memoryLogger, rejectionOf } from "./support/fakes.ts";
import { bytePipe, bytes, readText } from "./support/streams.ts";
import { asFrame } from "./support/unsafe.ts";

const PING: JsonRpcMessage = { jsonrpc: "2.0", id: "r1", method: "host.status", params: {} };

interface Pair {
  readonly client: Transport;
  readonly server: Transport;
  /** 서버가 클라이언트에게 쓴 바이트를 직접 읽는 끝 */
  readonly rawToClient: BytePipe;
  readonly rawToServer: BytePipe;
}
interface BytePipe {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

function jsonOf(text: string): unknown {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : undefined;
}

function pair(): Pair {
  const toServer = bytePipe();
  const toClient = bytePipe();
  return {
    client: createStdioTransport({ readable: toClient.readable, writable: toServer.writable }),
    server: createStdioTransport({ readable: toServer.readable, writable: toClient.writable }),
    rawToClient: toClient,
    rawToServer: toServer,
  };
}

function collect(transport: Transport): { messages: unknown[]; closes: CloseInfo[] } {
  const messages: unknown[] = [];
  const closes: CloseInfo[] = [];
  transport.onMessage((message) => {
    messages.push(message);
  });
  transport.onClose((info) => {
    closes.push(info);
  });
  return { messages, closes };
}

async function until(condition: () => boolean, attempts = 200): Promise<void> {
  if (condition() || attempts <= 0) return;
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
  await until(condition, attempts - 1);
}

describe("stdio transport", () => {
  test("messages arrive in send order", async () => {
    const { client, server } = pair();
    const received = collect(server);
    const sent = Array.from({ length: 20 }, (_unused, index) => ({
      ...PING,
      id: `r${String(index + 1)}`,
    }));
    await Promise.all(sent.map((message) => client.send(message)));
    await until(() => received.messages.length === sent.length);
    expect(received.messages).toEqual(sent);
  });

  test("EOF closes once with reason eof and later sends are rejected", async () => {
    const { client, server } = pair();
    const received = collect(server);
    await client.close();
    await until(() => received.closes.length > 0);
    expect(received.closes).toEqual([{ reason: "eof" }]);
    expect(await rejectionOf(server.send(PING))).toEqual(new Error("transport closed"));
    // 닫힌 뒤 구독해도 닫힘 사실을 한 번 전달받는다
    const late: CloseInfo[] = [];
    server.onClose((info) => {
      late.push(info);
    });
    await until(() => late.length > 0);
    expect(late).toEqual([{ reason: "eof" }]);
  });

  test("close() reports local with the reason and rejects later sends", async () => {
    const { client } = pair();
    const received = collect(client);
    await client.close("bye");
    expect(received.closes).toEqual([{ reason: "local", message: "bye" }]);
    expect(await rejectionOf(client.send(PING))).toEqual(new Error("transport closed"));
  });

  test("a line that is not JSON gets -32700 and the connection stays usable", async () => {
    const io = bytePipe();
    const back = bytePipe();
    const server = createStdioTransport({ readable: io.readable, writable: back.writable });
    const received = collect(server);
    const writer = io.writable.getWriter();
    await writer.write(bytes(`{oops\n${JSON.stringify(PING)}\n`));
    const reply = await readText(back.readable, (text) => text.includes("\n"));
    expect(JSON.parse(reply)).toMatchObject({ id: null, error: { code: -32700 } });
    await until(() => received.messages.length === 1);
    expect(received.messages).toEqual([PING]);
  });

  test("an oversized frame gets -32600 frameTooLarge and the next frame is delivered", async () => {
    const io = bytePipe();
    const back = bytePipe();
    const logger = memoryLogger();
    const server = createStdioTransportWith(
      { readable: io.readable, writable: back.writable, maxFrameBytes: 128 },
      { logger },
    );
    const received = collect(server);
    const writer = io.writable.getWriter();
    await writer.write(
      bytes(`${JSON.stringify({ pad: "x".repeat(400) })}\n${JSON.stringify(PING)}\n`),
    );
    const reply = await readText(back.readable, (text) => text.includes("\n"));
    expect(JSON.parse(reply)).toMatchObject({
      id: null,
      error: { code: -32600, data: { details: { issue: "frameTooLarge" } } },
    });
    await until(() => received.messages.length === 1);
    expect(received.messages).toEqual([PING]);
    expect(logger.records.some((record) => record.event === "stdio.frame_rejected")).toBe(true);
  });

  test("messages that arrive before the first handler are delivered when it attaches", async () => {
    const io = bytePipe();
    const back = bytePipe();
    const server = createStdioTransport({ readable: io.readable, writable: back.writable });
    const closes: CloseInfo[] = [];
    // onClose만 먼저 붙이면 읽기가 시작되고 메시지는 쌓인다
    server.onClose((info) => {
      closes.push(info);
    });
    const writer = io.writable.getWriter();
    await writer.write(bytes(`${JSON.stringify(PING)}\n`));
    await until(() => false);
    const late: unknown[] = [];
    server.onMessage((message) => {
      late.push(message);
    });
    await until(() => late.length === 1);
    expect(late).toEqual([PING]);
  });

  test("an unterminated tail at EOF is dropped and logged", async () => {
    const io = bytePipe();
    const back = bytePipe();
    const logger = memoryLogger();
    const server = createStdioTransportWith(
      { readable: io.readable, writable: back.writable },
      { logger },
    );
    const received = collect(server);
    const writer = io.writable.getWriter();
    await writer.write(bytes(`${JSON.stringify(PING)}\n{"jsonrpc"`));
    await writer.close();
    await until(() => received.closes.length > 0);
    expect(received.messages).toEqual([PING]);
    expect(received.closes).toEqual([{ reason: "eof" }]);
    expect(
      logger.records.find((record) => record.event === "stdio.partial_frame_dropped")?.fields,
    ).toEqual({
      droppedBytes: 10,
    });
  });

  test("a handler that throws closes the transport with an error instead of killing the read loop", async () => {
    const io = bytePipe();
    const back = bytePipe();
    const logger = memoryLogger();
    const server = createStdioTransportWith(
      { readable: io.readable, writable: back.writable },
      { logger },
    );
    const closes: CloseInfo[] = [];
    server.onClose((info) => {
      closes.push(info);
    });
    server.onMessage(() => {
      throw new Error("handler broke");
    });
    const writer = io.writable.getWriter();
    await writer.write(bytes(`${JSON.stringify(PING)}\n`));
    await until(() => closes.length > 0);
    expect(closes).toEqual([{ reason: "error", message: "message_handler_failed" }]);
    expect(logger.records.some((record) => record.event === "stdio.handler_failed")).toBe(true);
  });

  test("a write that fails closes the transport with an error", async () => {
    const failing = new WritableStream<Uint8Array>({
      write() {
        throw new Error("EPIPE");
      },
    });
    const io = bytePipe();
    const transport = createStdioTransport({ readable: io.readable, writable: failing });
    const received = collect(transport);
    expect(await rejectionOf(transport.send(PING))).toEqual(new Error("EPIPE"));
    await until(() => received.closes.length > 0);
    expect(received.closes).toEqual([{ reason: "error", message: "EPIPE" }]);
  });

  test("a message JSON cannot carry is rejected without closing", async () => {
    const { client } = pair();
    const received = collect(client);
    expect(await rejectionOf(client.send(asFrame(undefined)))).toEqual(
      new Error("message is not JSON-serializable"),
    );
    expect(received.closes).toEqual([]);
  });

  test("writes wait for the sink: a slow sink still receives frames in order", async () => {
    const seen: string[] = [];
    const slow = new WritableStream<Uint8Array>(
      {
        async write(chunk) {
          await Promise.resolve();
          seen.push(new TextDecoder().decode(chunk));
        },
      },
      { highWaterMark: 1 },
    );
    const io = bytePipe();
    const transport = createStdioTransport({ readable: io.readable, writable: slow });
    const sent = Array.from({ length: 10 }, (_unused, index) => ({
      ...PING,
      id: `r${String(index + 1)}`,
    }));
    await Promise.all(sent.map((message) => transport.send(message)));
    expect(seen.map((line) => jsonOf(line))).toEqual(sent);
  });
});
