// 소켓 launcher 시험. 실제 Unix 소켓에 임시 서비스 흉내를 세우고 바이트가 양쪽으로 그대로 가는지 본다.
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { EngineEvent, Launched } from "../../../src/main/engine/launcher.ts";
import { createSocketLauncher } from "../../../src/web/session/socket-launcher.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { ENCODER, startFakeService, waitFor, type FakeService } from "./support.ts";

afterEach(cleanupTempDirs);

const services: FakeService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function serviceAt(): Promise<FakeService> {
  const service = await startFakeService();
  services.push(service);
  return service;
}

/** 다음 이벤트를 하나 받는다. 끝이면 null */
async function next(launched: Launched): Promise<EngineEvent | null> {
  return launched.events.next();
}

async function launchOk(socketPath: string): Promise<Launched> {
  const launcher = createSocketLauncher({ socketPath });
  const result = await launcher.launch({ kind: "local" }, "default");
  if (!result.ok) throw new Error(`launch failed: ${result.error.message}`);
  return result.value;
}

describe("socket launcher", () => {
  test("a missing service socket is a launch failure that names only the code", async () => {
    const socketPath = path.join(tempDir(), "absent.sock");
    const launcher = createSocketLauncher({ socketPath });
    const result = await launcher.launch({ kind: "local" }, "default");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("the service socket is not reachable (ENOENT)");
    expect(result.error.message).not.toContain(socketPath);
  });

  test("a path Node refuses to open is a launch failure, not a throw", async () => {
    const launcher = createSocketLauncher({ socketPath: "bad\0path.sock" });
    const result = await launcher.launch({ kind: "local" }, "default");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message.startsWith("the service socket is not reachable (")).toBe(true);
  });

  test("a remote target is refused without touching any socket", async () => {
    const launcher = createSocketLauncher({ socketPath: path.join(tempDir(), "x.sock") });
    const result = await launcher.launch({ kind: "remote", address: "wss://host:1" }, "default");
    expect(result).toEqual({
      ok: false,
      error: { message: "the gateway serves only the local service" },
    });
  });

  test("one-shot commands are refused (the gateway routes them to the sidecar)", async () => {
    const launcher = createSocketLauncher({ socketPath: path.join(tempDir(), "x.sock") });
    const result = await launcher.runOnce(["service", "status", "--json"]);
    expect(result).toEqual({
      ok: false,
      error: { message: "one-shot commands are not run over the service socket" },
    });
  });

  test("bytes go to the service unchanged and come back as stdout bytes", async () => {
    const service = await serviceAt();
    const launched = await launchOk(service.socketPath);
    expect(launched.pid).toBe(0);
    expect(launched.viaService).toBe(true);

    const line = ENCODER.encode('{"jsonrpc":"2.0"}\n');
    const binary = new Uint8Array([0x7b, 0x7d, 0x0a, 0xff, 0x00, 0x80]);
    await launched.stdin.write(line);
    await launched.stdin.write(binary);
    await waitFor("the service to receive both writes", () => {
      const connection = service.connections[0];
      return (
        connection !== undefined && connection.received().length === line.length + binary.length
      );
    });
    const connection = service.connections[0];
    expect(connection?.received()).toEqual(new Uint8Array([...line, ...binary]));

    connection?.write(ENCODER.encode('{"id":1}\n'));
    const event = await next(launched);
    expect(event?.kind).toBe("stdout");
    if (event?.kind !== "stdout") return;
    expect(new TextDecoder().decode(event.bytes)).toBe('{"id":1}\n');
    launched.killGroup();
  });

  test("a server that ends the connection shows as terminated, then the stream ends", async () => {
    const service = await serviceAt();
    const launched = await launchOk(service.socketPath);
    await waitFor("the connection to be accepted", () => service.connections.length === 1);
    service.connections[0]?.socket.end();
    expect(await next(launched)).toEqual({ kind: "terminated", code: null, signal: null });
    expect(await next(launched)).toBeNull();
  });

  test("killGroup ends the connection and reports the termination", async () => {
    const service = await serviceAt();
    const launched = await launchOk(service.socketPath);
    await waitFor("the connection to be accepted", () => service.connections.length === 1);
    launched.killGroup();
    expect(await next(launched)).toEqual({ kind: "terminated", code: null, signal: null });
    await waitFor("the service to see the close", () => service.connections[0]?.closed() === true);
  });

  test("closing stdin is an end of input the service can see", async () => {
    const service = await serviceAt();
    const launched = await launchOk(service.socketPath);
    await waitFor("the connection to be accepted", () => service.connections.length === 1);
    launched.stdin.close();
    await waitFor("the service to see the end", () => service.connections[0]?.closed() === true);
    expect(service.connections[0]?.closed()).toBe(true);
    expect(await next(launched)).toEqual({ kind: "terminated", code: null, signal: null });
  });
});
