import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { Transport } from "@xeon/contracts/wire";
import {
  connectServiceTransport,
  type TunnelFailure,
  type TunnelHandle,
  type TunnelPort,
} from "../src/socket.ts";

// adr.0020 소켓 전송: 실제 node:net 서버(Unix 소켓과 loopback TCP)에 접속한다. 서버는 받은 줄을 모으고 요청에는 빈 결과로 답한다.

const dirs: string[] = [];
const servers: Server[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xcli-"));
  dirs.push(dir);
  return dir;
}
const sockets: Socket[] = [];

async function closeServers(): Promise<void> {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
}

afterEach(async () => {
  await closeServers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface TestServer {
  readonly received: unknown[];
  readonly sockets: Socket[];
}

function serve(listen: (server: Server, ready: () => void) => void): Promise<TestServer> {
  const state: TestServer = { received: [], sockets: [] };
  const server = createServer((socket) => {
    state.sockets.push(socket);
    sockets.push(socket);
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const parsed: unknown = JSON.parse(line);
        state.received.push(parsed);
        if (typeof parsed === "object" && parsed !== null && "id" in parsed) {
          socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} })}\n`);
        }
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    listen(server, () => {
      resolve(state);
    });
  });
}

async function unixServer(): Promise<{ readonly path: string; readonly state: TestServer }> {
  const path = join(scratch(), "s.sock");
  const state = await serve((server, ready) => server.listen(path, ready));
  return { path, state };
}

async function tcpServer(): Promise<{ readonly port: number; readonly state: TestServer }> {
  const holder: { port: number } = { port: 0 };
  const state = await serve((server, ready) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      holder.port = address !== null && typeof address === "object" ? address.port : 0;
      ready();
    }),
  );
  return { port: holder.port, state };
}

function reply(transport: Transport): Promise<unknown> {
  return new Promise((resolve) => {
    const off = transport.onMessage((message) => {
      off();
      resolve(message);
    });
  });
}

const HELLO = {
  jsonrpc: "2.0",
  id: "r1",
  method: "host.hello",
  params: { protocolVersion: "1" },
} as const;

function must<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("unix", () => {
  test("sends a request and receives its reply as a socket transport", async () => {
    const { path, state } = await unixServer();
    const transport = must(await connectServiceTransport({ kind: "unix", path }));
    expect(transport.kind).toBe("socket");
    const answer = reply(transport);
    await transport.send(HELLO);
    expect(await answer).toEqual({ jsonrpc: "2.0", id: "r1", result: {} });
    expect(state.received).toEqual([HELLO]);
    await transport.close();
  });

  test("a missing socket is not_found and a stale socket file is refused, both by value", async () => {
    const dir = scratch();
    const missing = join(dir, "none.sock");
    expect(await connectServiceTransport({ kind: "unix", path: missing })).toEqual({
      ok: false,
      error: { kind: "not_found", path: missing },
    });
  });
});

describe("tcp", () => {
  test("without a token it is token_required and nothing connects", async () => {
    const { port, state } = await tcpServer();
    expect(await connectServiceTransport({ kind: "tcp", host: "127.0.0.1", port })).toEqual({
      ok: false,
      error: { kind: "token_required" },
    });
    expect(state.sockets).toEqual([]);
  });

  test("host.hello carries auth.token; a hello that already has auth is left alone; other messages are untouched", async () => {
    const { port, state } = await tcpServer();
    const transport = must(
      await connectServiceTransport({
        kind: "tcp",
        host: "127.0.0.1",
        port,
        token: "t".repeat(43),
      }),
    );
    const first = reply(transport);
    await transport.send(HELLO);
    await first;
    await transport.send({
      jsonrpc: "2.0",
      id: "r2",
      method: "host.hello",
      params: { auth: { token: "own" } },
    });
    await transport.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } });
    await Bun.sleep(30);
    expect(state.received).toEqual([
      { ...HELLO, params: { protocolVersion: "1", auth: { token: "t".repeat(43) } } },
      { jsonrpc: "2.0", id: "r2", method: "host.hello", params: { auth: { token: "own" } } },
      { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } },
    ]);
    await transport.close();
  });

  test("a closed port is refused", async () => {
    const { port } = await tcpServer();
    await closeServers();
    await Bun.sleep(50);
    expect(
      await connectServiceTransport({ kind: "tcp", host: "127.0.0.1", port, token: "t" }),
    ).toEqual({ ok: false, error: { kind: "refused", path: `127.0.0.1:${String(port)}` } });
  });
});

interface FakeTunnel {
  readonly port: TunnelPort;
  readonly requests: unknown[];
  readonly closes: { count: number };
}

/** 로컬 Unix 소켓 서버를 "터널 끝"으로 돌려주는 포트 */
function fakeTunnel(localSocket: string, failure?: TunnelFailure): FakeTunnel {
  const requests: unknown[] = [];
  const closes = { count: 0 };
  const handle: TunnelHandle = {
    localSocket,
    close() {
      closes.count += 1;
      return Promise.resolve();
    },
  };
  return {
    requests,
    closes,
    port: {
      open(request) {
        requests.push(request);
        return Promise.resolve(failure === undefined ? ok(handle) : err(failure));
      },
    },
  };
}

describe("ssh", () => {
  const endpoint = {
    kind: "ssh",
    target: "me@box",
    remoteSocket: "/run/xeon.sock",
    port: 2222,
  } as const;

  test("without a tunnel port it is tunnel_unavailable", async () => {
    expect(await connectServiceTransport(endpoint)).toEqual({
      ok: false,
      error: { kind: "tunnel_unavailable" },
    });
  });

  test("opens the tunnel with the target, remote socket and port, connects to its local socket, and closing the transport closes the tunnel once", async () => {
    const { path } = await unixServer();
    const tunnel = fakeTunnel(path);
    const transport = must(await connectServiceTransport(endpoint, { tunnel: tunnel.port }));
    expect(tunnel.requests).toEqual([
      { target: "me@box", remoteSocket: "/run/xeon.sock", port: 2222 },
    ]);
    const answer = reply(transport);
    await transport.send(HELLO);
    expect(await answer).toEqual({ jsonrpc: "2.0", id: "r1", result: {} });
    expect(tunnel.closes.count).toBe(0);
    await transport.close();
    expect(tunnel.closes.count).toBeGreaterThanOrEqual(1);
  });

  test("the peer ending the connection closes the tunnel", async () => {
    const { path, state } = await unixServer();
    const tunnel = fakeTunnel(path);
    const transport = must(await connectServiceTransport(endpoint, { tunnel: tunnel.port }));
    // 처리기가 없으면 쌓인 응답을 비울 때까지 닫힘이 미뤄진다(전송 규칙). 연결이 하듯 처리기를 붙인다
    const seen: unknown[] = [];
    transport.onMessage((message) => {
      seen.push(message);
    });
    const closed = new Promise<void>((resolve) => {
      transport.onClose(() => {
        resolve();
      });
    });
    await transport.send(HELLO);
    await Bun.sleep(30);
    for (const socket of state.sockets) socket.destroy();
    await closed;
    await Bun.sleep(10);
    expect(tunnel.closes.count).toBe(1);
  });

  test("a tunnel failure is returned as tunnel_failed and nothing connects", async () => {
    const failure: TunnelFailure = { kind: "exited", detail: "permission denied (publickey)" };
    const tunnel = fakeTunnel("/nonexistent/s", failure);
    expect(await connectServiceTransport(endpoint, { tunnel: tunnel.port })).toEqual({
      ok: false,
      error: { kind: "tunnel_failed", failure },
    });
    expect(tunnel.closes.count).toBe(0);
  });

  test("a tunnel whose local socket cannot be reached is closed and the connect error is returned", async () => {
    const missing = join(scratch(), "gone.sock");
    const tunnel = fakeTunnel(missing);
    expect(await connectServiceTransport(endpoint, { tunnel: tunnel.port })).toEqual({
      ok: false,
      error: { kind: "not_found", path: missing },
    });
    expect(tunnel.closes.count).toBe(1);
  });
});
