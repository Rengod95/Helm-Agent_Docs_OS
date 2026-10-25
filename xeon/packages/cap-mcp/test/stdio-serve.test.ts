import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { ReadBuffer, serializeMessage, type JSONRPCMessage } from "@modelcontextprotocol/client";
import { createStubServer } from "../src/testing/stub-server.ts";
import { serveStubOverStdio } from "../src/testing/stdio-serve.ts";

// 스텁 서버를 줄바꿈 JSON-RPC로 서빙한다. 실제 자식 프로세스 시험(apps/host)이 같은 함수를 쓴다.

function collect(stream: PassThrough): { readonly messages: JSONRPCMessage[] } {
  const buffer = new ReadBuffer();
  const messages: JSONRPCMessage[] = [];
  stream.on("data", (chunk: Buffer) => {
    buffer.append(chunk);
    for (;;) {
      const next = buffer.readMessage();
      if (next === null) return;
      messages.push(next);
    }
  });
  return { messages };
}

describe("serveStubOverStdio", () => {
  test("a request line on stdin is answered on stdout and the promise settles when stdin ends", async () => {
    const stub = createStubServer({ era: "modern", tools: [{ name: "echo" }, { name: "add" }] });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out = collect(stdout);
    const served = serveStubOverStdio(stub, { stdin, stdout });
    stdin.write(serializeMessage({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }));
    stdin.end();
    await served;
    const [reply] = out.messages;
    expect(out.messages).toHaveLength(1);
    expect(reply).toMatchObject({ jsonrpc: "2.0", id: 7 });
    const tools =
      reply !== undefined && "result" in reply && typeof reply.result === "object"
        ? JSON.stringify(reply.result)
        : "";
    expect(tools).toContain('"echo"');
    expect(tools).toContain('"add"');
  });
});
