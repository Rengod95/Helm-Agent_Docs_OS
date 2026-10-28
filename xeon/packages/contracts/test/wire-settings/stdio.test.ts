import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createStdioTransport } from "../../src/wire-settings/wire/index.ts";

// F.wire-settings.spec §3.1: JSON Lines stdio 전송. Bun·Node API 없이 웹 스트림만 쓴다. HostConnection 구현은 `@xeon/client`로 옮겼다(adr.0020).

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function streamPair(): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  return { readable, writable };
}

describe("createStdioTransport (runtime neutral)", () => {
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
  for (const file of ["stdio.ts", "framing.ts"]) {
    test(`${file} uses no Bun or Node module`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source).not.toMatch(/from\s+"(node:|bun|fs|path|child_process)/);
      expect(source).not.toMatch(/\bBun\./);
      expect(source).not.toMatch(/\bBuffer\b/);
      expect(source).not.toMatch(/\bprocess\.(env|cwd|argv|nextTick|stdout|stdin|stderr|exit)\b/);
    });
  }
});
