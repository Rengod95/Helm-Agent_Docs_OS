import { expect, test } from "bun:test";
import { WIRE_LIMITS, type CloseInfo, type JsonRpcMessage } from "@xeon/contracts/wire";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { settleUntil } from "../fixtures/clock.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { stdioPair, stdioStreams } from "../fixtures/stdio-pair.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function note(index: number): JsonRpcMessage {
  return { jsonrpc: "2.0", method: "events.batch", params: { index } };
}

/** 서버 쪽 전송과, 그 전송으로 들어가는 날 바이트 쓰기·나오는 바이트 읽기를 돌려준다 */
function rawServer(maxFrameBytes?: number) {
  const streams = stdioStreams();
  const transport = createStdioTransport({
    readable: streams.clientToServer.readable,
    writable: streams.serverToClient.writable,
    ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }),
  });
  const writer = streams.clientToServer.writable.getWriter();
  const reader = streams.serverToClient.readable.getReader();
  const seen: unknown[] = [];
  const closes: CloseInfo[] = [];
  transport.onMessage((message) => {
    seen.push(message);
  });
  transport.onClose((info) => {
    closes.push(info);
  });
  const chunks: string[] = [];
  const pump = (): void => {
    reader.read().then(
      (chunk) => {
        if (chunk.done) return undefined;
        chunks.push(decoder.decode(chunk.value));
        pump();
        return undefined;
      },
      () => undefined,
    );
  };
  pump();
  return {
    transport,
    seen,
    closes,
    output: () => chunks.join(""),
    write: (text: string) => writer.write(encoder.encode(text)),
    endInput: () => writer.close(),
  };
}

test("each line is one message, whatever the chunk boundaries", async () => {
  const server = rawServer();
  const line = `${JSON.stringify(note(1))}\n${JSON.stringify(note(2))}\n`;
  // 줄 가운데에서 청크를 자른다
  await server.write(line.slice(0, 20));
  await server.write(line.slice(20));
  await settleUntil(() => server.seen.length === 2);
  expect(server.seen).toEqual([note(1), note(2)]);
});

test("a CRLF line ending and blank lines are tolerated", async () => {
  const server = rawServer();
  await server.write(`\n${JSON.stringify(note(1))}\r\n\n`);
  await settleUntil(() => server.seen.length === 1);
  expect(server.seen).toEqual([note(1)]);
});

test("a line that is not JSON is -32700 with a null id and the connection stays usable", async () => {
  const server = rawServer();
  await server.write("not json\n");
  await server.write(`${JSON.stringify(note(1))}\n`);
  await settleUntil(() => server.seen.length === 1 && server.output().includes("\n"));
  const reply: unknown = JSON.parse(server.output().split("\n")[0] ?? "");
  expect(reply).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
  expect(server.seen).toEqual([note(1)]);
  expect(server.closes).toEqual([]);
});

test("a line over maxFrameBytes is discarded to its end and answered -32600 frameTooLarge", async () => {
  const server = rawServer(64);
  await server.write(`${"x".repeat(200)}\n`);
  await server.write(`${JSON.stringify(note(1))}\n`);
  await settleUntil(() => server.seen.length === 1 && server.output().includes("\n"));
  const reply: unknown = JSON.parse(server.output().split("\n")[0] ?? "");
  expect(reply).toMatchObject({
    id: null,
    error: { code: -32600, data: { details: { issue: "frameTooLarge" } } },
  });
  expect(server.seen).toEqual([note(1)]);
});

test("a line of exactly maxFrameBytes is accepted, one byte more is not", async () => {
  const exact = JSON.stringify(note(7));
  const server = rawServer(exact.length);
  await server.write(`${exact}\n`);
  await settleUntil(() => server.seen.length === 1);
  expect(server.seen).toEqual([note(7)]);
  await server.write(`${exact} \n`);
  await settleUntil(() => server.output().includes("frameTooLarge"));
  expect(server.seen).toHaveLength(1);
});

test("the default frame limit is WIRE_LIMITS.maxFrameBytes", async () => {
  const server = rawServer();
  await server.write(`${"x".repeat(WIRE_LIMITS.maxFrameBytes + 1)}\n`);
  await settleUntil(() => server.output().includes("frameTooLarge"));
  expect(server.seen).toHaveLength(0);
});

test("end of input is onClose with eof, and an unfinished last line is dropped", async () => {
  const server = rawServer();
  await server.write(`${JSON.stringify(note(1))}\n{"jsonrpc":"2.0"`);
  await server.endInput();
  await settleUntil(() => server.closes.length === 1);
  expect(server.closes).toEqual([{ reason: "eof" }]);
  expect(server.seen).toEqual([note(1)]);
});

test("a pair delivers messages both ways in order and closing one end is eof for the other", async () => {
  const pair = stdioPair();
  const atServer: unknown[] = [];
  const atClient: unknown[] = [];
  const clientCloses: CloseInfo[] = [];
  const serverCloses: CloseInfo[] = [];
  pair.server.onMessage((message) => {
    atServer.push(message);
  });
  pair.client.onMessage((message) => {
    atClient.push(message);
  });
  pair.client.onClose((info) => {
    clientCloses.push(info);
  });
  pair.server.onClose((info) => {
    serverCloses.push(info);
  });
  await pair.client.send(note(1));
  await pair.client.send(note(2));
  await pair.server.send(note(3));
  await settleUntil(() => atServer.length === 2 && atClient.length === 1);
  expect(atServer).toEqual([note(1), note(2)]);
  expect(atClient).toEqual([note(3)]);
  await pair.client.close("done");
  await settleUntil(() => serverCloses.length === 1);
  expect(clientCloses).toEqual([{ reason: "local", message: "done" }]);
  expect(serverCloses).toEqual([{ reason: "eof" }]);
  expect(String(await rejectionOf(pair.client.send(note(4))))).toContain("closed");
});

test("a write failure closes the transport with an error", async () => {
  const closes: CloseInfo[] = [];
  const transport = createStdioTransport({
    readable: new ReadableStream<Uint8Array>(),
    writable: new WritableStream<Uint8Array>({
      write() {
        throw new Error("pipe is gone");
      },
    }),
  });
  transport.onClose((info) => {
    closes.push(info);
  });
  expect(String(await rejectionOf(transport.send(note(1))))).toContain("pipe is gone");
  expect(closes).toEqual([{ reason: "error", message: "pipe is gone" }]);
});
