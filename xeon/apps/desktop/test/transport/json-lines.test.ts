import { describe, expect, test } from "bun:test";
import type { CloseInfo } from "@xeon/contracts/wire";
import { createStdioTransport } from "../../src/transport/json-lines.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function pipe(): {
  readonly readable: ReadableStream<Uint8Array>;
  push(text: string): void;
  end(): void;
  readonly sent: string[];
  readonly writable: WritableStream<Uint8Array>;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const sent: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      sent.push(dec.decode(chunk));
    },
  });
  return {
    readable,
    writable,
    sent,
    push: (text) => controller?.enqueue(enc.encode(text)),
    end: () => controller?.close(),
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("json-lines transport", () => {
  test("frames split across chunks and several frames in one chunk keep their order", async () => {
    const p = pipe();
    const transport = createStdioTransport({ readable: p.readable, writable: p.writable });
    const got: unknown[] = [];
    transport.onMessage((m) => void got.push(m));
    p.push('{"jsonrpc":"2.0","method":"a","par');
    p.push('ams":{}}\n{"jsonrpc":"2.0","method":"b","params":{}}\n');
    await tick();
    expect(got).toEqual([
      { jsonrpc: "2.0", method: "a", params: {} },
      { jsonrpc: "2.0", method: "b", params: {} },
    ]);
  });

  test("EOF closes with reason eof and drops the unterminated tail", async () => {
    const p = pipe();
    const transport = createStdioTransport({ readable: p.readable, writable: p.writable });
    const closes: CloseInfo[] = [];
    transport.onClose((i) => void closes.push(i));
    transport.onMessage(() => {});
    p.push('{"partial":');
    p.end();
    await tick();
    expect(closes).toEqual([{ reason: "eof" }]);
  });

  test("send writes one complete frame per write", async () => {
    const p = pipe();
    const transport = createStdioTransport({ readable: p.readable, writable: p.writable });
    await transport.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } });
    expect(p.sent).toEqual(['{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"r1"}}\n']);
  });
});
