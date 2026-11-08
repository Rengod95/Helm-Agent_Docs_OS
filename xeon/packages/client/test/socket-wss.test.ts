import { afterEach, describe, expect, test } from "bun:test";
import { createTestTlsIdentity } from "@fresnel/platform-process/testing";
import { connectServiceTransport } from "../src/socket.ts";

// 데스크톱 쪽 wss 접속(L4.remote.spec §3.1, §8.2). 시험 안에서 임시 자체 서명 인증서와 루프백 TLS WebSocket 서버(W2 대역)를 띄운다.
// openssl이 없으면 건너뛴다.

const identity = await createTestTlsIdentity();
const hasOpenssl = identity !== null;
const TOKEN = "device-token-for-tests-only";

describe.skipIf(!hasOpenssl)("connectServiceTransport wss", () => {
  const cert = identity?.cert ?? "";
  const key = identity?.key ?? "";
  const pin = identity?.fingerprint ?? "";
  const stops: (() => unknown)[] = [];

  afterEach(async () => {
    await Promise.all(stops.splice(0).map(async (stop) => stop()));
  });

  function serve(): { readonly port: number; readonly auth: (string | null)[] } {
    const auth: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert, key },
      fetch(request, srv) {
        auth.push(request.headers.get("authorization"));
        if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
          return new Response("no", { status: 401 });
        }
        if (srv.upgrade(request)) return undefined;
        return new Response("bad", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.send(typeof message === "string" ? message : new TextDecoder().decode(message));
        },
      },
    });
    stops.push(() => server.stop(true));
    return { port: server.port ?? 0, auth };
  }

  const request = { jsonrpc: "2.0", id: 1, method: "host.hello", params: { x: 1 } } as const;

  test("the pinned endpoint connects, sends the device token as a bearer header and round-trips a frame", async () => {
    const gateway = serve();
    const connected = await connectServiceTransport({
      kind: "wss",
      host: "127.0.0.1",
      port: gateway.port,
      pin,
      token: TOKEN,
    });
    if (!connected.ok) throw new Error(JSON.stringify(connected.error));
    const echoed = new Promise<unknown>((resolve) => {
      connected.value.onMessage(resolve);
    });
    await connected.value.send(request);
    expect(await echoed).toEqual(request);
    expect(gateway.auth).toEqual([`Bearer ${TOKEN}`]);
    await connected.value.close();
  });

  test("a different pin is fingerprint_changed with both values and no upgrade request", async () => {
    const gateway = serve();
    const wrong = "0".repeat(64);
    const result = await connectServiceTransport({
      kind: "wss",
      host: "127.0.0.1",
      port: gateway.port,
      pin: wrong,
      token: TOKEN,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "fingerprint_changed", expected: wrong, actual: pin },
    });
    expect(gateway.auth).toEqual([]);
  });

  test("a missing or wrong token is gateway_rejected", async () => {
    const gateway = serve();
    const result = await connectServiceTransport({
      kind: "wss",
      host: "127.0.0.1",
      port: gateway.port,
      pin,
      token: "wrong-token-for-tests-only",
    });
    expect(result).toEqual({ ok: false, error: { kind: "gateway_rejected" } });
  });

  test("no pin and an unknown self-signed certificate is tls_untrusted with the fingerprint to confirm", async () => {
    const gateway = serve();
    const result = await connectServiceTransport({
      kind: "wss",
      host: "127.0.0.1",
      port: gateway.port,
      token: TOKEN,
    });
    expect(result).toEqual({ ok: false, error: { kind: "tls_untrusted", fingerprint: pin } });
  });

  test("nothing listening is refused", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const port = closed.port ?? 0;
    await closed.stop(true);
    const result = await connectServiceTransport({ kind: "wss", host: "127.0.0.1", port, pin });
    expect(result).toEqual({
      ok: false,
      error: { kind: "refused", path: `127.0.0.1:${String(port)}` },
    });
  });
});
