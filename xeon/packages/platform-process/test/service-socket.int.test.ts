import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { Transport } from "@xeon/contracts/wire";
import {
  bindServiceSocket,
  connectSocket,
  listenSocket,
  type ActivationLock,
  type SocketListener,
} from "../src/index.ts";
import { waitFor } from "./support/real-time.ts";

const STALE = `${import.meta.dir}/fixtures/stale-socket.ts`;

const dirs: string[] = [];
const listeners: SocketListener[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xsvc-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** 첫 메시지를 받으면 그대로 돌려주는 서버 */
function echo(listener: SocketListener): void {
  listener.onConnection((transport) => {
    transport.onMessage((message) => {
      if (typeof message === "object" && message !== null && "id" in message) {
        void transport.send({ jsonrpc: "2.0", id: "r1", result: { echoed: true } });
      }
    });
  });
}

function nextMessage(transport: Transport): Promise<unknown> {
  return new Promise((resolve) => {
    const off = transport.onMessage((message) => {
      off();
      resolve(message);
    });
  });
}

/** 한 번에 하나의 락 사용자만 허용하는 활성화 잠금 */
function makeLock(): ActivationLock {
  const held = { value: false };
  return async (fn) => {
    if (held.value) return err({ kind: "busy" });
    held.value = true;
    try {
      return ok(await fn());
    } finally {
      held.value = false;
    }
  };
}

const alwaysBusy: ActivationLock = () => Promise.resolve(err({ kind: "busy" }));

describe("unix socket", () => {
  test("the socket file has mode 0600 and carries messages both ways as kind socket", async () => {
    const path = join(scratch(), "x.sock");
    const listener = must(await listenSocket({ kind: "unix", path }));
    listeners.push(listener);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    echo(listener);
    const client = must(await connectSocket({ kind: "unix", path }));
    expect(client.kind).toBe("socket");
    const reply = nextMessage(client);
    await client.send({ jsonrpc: "2.0", id: "r1", method: "host.status", params: {} });
    expect(await reply).toEqual({ jsonrpc: "2.0", id: "r1", result: { echoed: true } });
    expect(await waitFor(() => listener.connectionCount === 1, 1000)).toBe(true);
    await client.close();
    expect(await waitFor(() => listener.connectionCount === 0, 1000)).toBe(true);
  });

  test("a client that connects and writes before any handler exists is served by the first handler", async () => {
    const path = join(scratch(), "x.sock");
    const listener = must(await listenSocket({ kind: "unix", path }));
    listeners.push(listener);
    const client = must(await connectSocket({ kind: "unix", path }));
    const reply = nextMessage(client);
    await client.send({ jsonrpc: "2.0", id: "r1", method: "host.hello", params: {} });
    // 연결이 서버에 닿은 뒤에 처리기를 붙인다
    expect(await waitFor(() => listener.connectionCount === 1, 1000)).toBe(true);
    echo(listener);
    expect(await reply).toEqual({ jsonrpc: "2.0", id: "r1", result: { echoed: true } });
    await client.close();
  });

  test("a path over the sun_path limit is rejected with path_too_long", async () => {
    const path = join(scratch(), "x".repeat(120));
    const result = await listenSocket({ kind: "unix", path });
    expect(!result.ok && result.error.kind).toBe("path_too_long");
  });

  test("connecting to a missing socket gives not_found", async () => {
    const result = await connectSocket({ kind: "unix", path: join(scratch(), "none.sock") });
    expect(!result.ok && result.error.kind).toBe("not_found");
  });

  test("closing the listener removes the socket file", async () => {
    const path = join(scratch(), "x.sock");
    const listener = must(await listenSocket({ kind: "unix", path }));
    await listener.close();
    expect(existsSync(path)).toBe(false);
  });
});

describe("tcp socket", () => {
  test("refuses to listen without a token", async () => {
    const result = await listenSocket({ kind: "tcp", host: "127.0.0.1", port: 0, token: "" });
    expect(result).toEqual({ ok: false, error: { kind: "token_required" } });
  });

  test("refuses a non-loopback host unless allowNonLoopback is given; loopback hosts are accepted", async () => {
    const refused = await listenSocket({
      kind: "tcp",
      host: "0.0.0.0",
      port: 0,
      token: "t".repeat(43),
    });
    expect(refused).toEqual({ ok: false, error: { kind: "tcp_not_loopback", host: "0.0.0.0" } });
    const v4 = must(
      await listenSocket({ kind: "tcp", host: "127.0.0.1", port: 0, token: "t".repeat(43) }),
    );
    listeners.push(v4);
    const v6 = await listenSocket({ kind: "tcp", host: "::1", port: 0, token: "t".repeat(43) });
    if (v6.ok) listeners.push(v6.value);
    else expect(v6.error.kind).not.toBe("tcp_not_loopback");
    const allowed = await listenSocket({
      kind: "tcp",
      host: "0.0.0.0",
      port: 0,
      token: "t".repeat(43),
      allowNonLoopback: true,
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) listeners.push(allowed.value);
  });

  test("with a token it listens and marks every peer as requiring the token", async () => {
    const listener = must(
      await listenSocket({ kind: "tcp", host: "127.0.0.1", port: 0, token: "t".repeat(43) }),
    );
    listeners.push(listener);
    const seen: boolean[] = [];
    listener.onConnection((_transport, peer) => {
      seen.push(peer.requiresToken);
    });
    const [host, port] = listener.path.split(":");
    const client = must(await connectSocket({ kind: "tcp", host: host ?? "", port: Number(port) }));
    expect(await waitFor(() => seen.length === 1, 1000)).toBe(true);
    expect(seen).toEqual([true]);
    await client.close();
  });
});

describe("bindServiceSocket (double start prevention)", () => {
  test("the second binder to a live path loses with in_use and the first keeps serving", async () => {
    const path = join(scratch(), "x.sock");
    const lock = makeLock();
    const first = must(await bindServiceSocket({ path, activationLock: lock }));
    listeners.push(first);
    echo(first);
    const second = await bindServiceSocket({ path, activationLock: lock });
    expect(second).toEqual({ ok: false, error: { kind: "in_use" } });
    const client = must(await connectSocket({ kind: "unix", path }));
    const reply = nextMessage(client);
    await client.send({ jsonrpc: "2.0", id: "r1", method: "host.status", params: {} });
    expect(await reply).toEqual({ jsonrpc: "2.0", id: "r1", result: { echoed: true } });
    await client.close();
  });

  test("a stale socket file left by a killed process is replaced", async () => {
    const path = join(scratch(), "x.sock");
    const child = spawn(process.execPath, [STALE, path], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => {
      child.stdout.once("data", () => {
        resolve();
      });
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
    expect(existsSync(path)).toBe(true);
    const bound = must(await bindServiceSocket({ path, activationLock: makeLock() }));
    listeners.push(bound);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("when another contender holds the activation lock the stale socket is left alone", async () => {
    const path = join(scratch(), "x.sock");
    const child = spawn(process.execPath, [STALE, path], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => {
      child.stdout.once("data", () => {
        resolve();
      });
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
    expect(await bindServiceSocket({ path, activationLock: alwaysBusy })).toEqual({
      ok: false,
      error: { kind: "in_use" },
    });
    expect(existsSync(path)).toBe(true);
  });
});
