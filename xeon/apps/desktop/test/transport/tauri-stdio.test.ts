import { describe, expect, test } from "bun:test";
import { createHostConnection } from "@xeon/client";
import { createStdioTransport } from "@xeon/client/stdio";
import {
  ACK_UNIT_BYTES,
  attachRelay,
  openEngineConnection,
} from "../../src/transport/tauri-stdio.ts";
import { fakeIpc, requestId } from "./fake-ipc.ts";

const deps = {
  stdioTransport: createStdioTransport,
  connect: (t: Parameters<typeof createHostConnection>[0]) => createHostConnection(t),
  client: { name: "xeon-desktop", version: "0.0.0" },
};

describe("relay streams", () => {
  test("bytes from the shell arrive on readable in order and are credited back in 256 KiB units", async () => {
    const fake = fakeIpc();
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const reader = attached.value.readable.getReader();
    const line = new Uint8Array(ACK_UNIT_BYTES / 2).fill(97);
    line[line.length - 1] = 10;
    fake.emitBytes(line);
    fake.emitBytes(line);
    fake.emitBytes(line);
    const sizes = [await reader.read(), await reader.read(), await reader.read()].map(
      (r) => r.value?.byteLength,
    );
    expect(sizes).toEqual([line.byteLength, line.byteLength, line.byteLength]);
    expect(fake.acks).toEqual([{ epoch: 1, bytes: ACK_UNIT_BYTES }]);
  });

  test("writable sends one engine_write per frame with the epoch", async () => {
    const fake = fakeIpc({ onWrite: () => {} });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const writer = attached.value.writable.getWriter();
    await writer.write(new TextEncoder().encode('{"a":1}\n'));
    expect(fake.written).toEqual([{ epoch: 1, text: '{"a":1}\n' }]);
  });

  test("a rejected engine_write fails the writable (the transport then closes with error)", async () => {
    const fake = fakeIpc({
      writeError: { kind: "command", command: "engine_write", code: "epoch-stale" },
    });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const writer = attached.value.writable.getWriter();
    expect(writer.write(new TextEncoder().encode("{}\n"))).rejects.toThrow("epoch-stale");
  });

  test("shell state events reach every listener and state() is the latest", async () => {
    const fake = fakeIpc({ state: { kind: "starting", source: "sidecar", attempt: 0 } });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const seen: string[] = [];
    attached.value.onState((s) => void seen.push(s.kind));
    expect(attached.value.state().kind).toBe("starting");
    fake.emitState({ kind: "running", source: "sidecar", pid: 1 });
    expect(seen).toEqual(["running"]);
    expect(attached.value.state().kind).toBe("running");
  });

  test("close detaches this epoch only", async () => {
    const fake = fakeIpc();
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    await attached.value.close();
    expect(fake.detached).toEqual([1]);
  });
});

describe("openEngineConnection", () => {
  test("does not open while the engine is not running", async () => {
    const fake = fakeIpc({ state: { kind: "stopping" } });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const opened = await openEngineConnection(deps, attached.value);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.error.kind).toBe("engine_not_running");
  });

  test("sends host.hello with client.kind desktop and returns the server answer", async () => {
    const fake = fakeIpc({
      onWrite: (message, f) => {
        if (requestId(message) === "") return; // 알림($/connectionReset)에는 응답이 없다
        f.emitLine({
          jsonrpc: "2.0",
          id: requestId(message),
          result: {
            protocolVersion: "0.1.0",
            server: { name: "xeon", version: "9.9.9" },
            storeId: "sto_00000000000000000000000001",
            transport: "stdio",
            features: [],
            experimental: [],
          },
        });
      },
    });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const opened = await openEngineConnection(deps, attached.value);
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.value.hello.server.version).toBe("9.9.9");
    // 새 페이지의 첫 메시지는 $/connectionReset이다. 이전 페이지의 hello가 남아 있어도 1002가 나오지 않게 한다
    const first: unknown = JSON.parse(fake.written[0]?.text ?? "null");
    expect(first).toMatchObject({ method: "$/connectionReset", params: {} });
    const sent: unknown = JSON.parse(fake.written[1]?.text ?? "null");
    expect(sent).toMatchObject({ method: "host.hello", params: { client: { kind: "desktop" } } });
  });

  test("a hello error becomes a hello OpenError with the wire code", async () => {
    const fake = fakeIpc({
      onWrite: (message, f) => {
        if (requestId(message) === "") return; // 알림($/connectionReset)에는 응답이 없다
        f.emitLine({
          jsonrpc: "2.0",
          id: requestId(message),
          error: {
            code: 1002,
            message: "dup",
            data: { kind: "host.helloDuplicate", retryable: false },
          },
        });
      },
    });
    const attached = await attachRelay(fake.ipc);
    if (!attached.ok) throw new Error("attach failed");
    const opened = await openEngineConnection(deps, attached.value);
    expect(!opened.ok && opened.error).toMatchObject({ kind: "hello", code: 1002 });
  });
});
