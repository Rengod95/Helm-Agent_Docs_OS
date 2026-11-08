import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@fresnel/contracts";
import type { JsonRpcMessage, Transport } from "@fresnel/contracts/wire";
import {
  connectWebSocket,
  probeTlsFingerprint,
  type TlsProbe,
  type WsConnectOptions,
  type WsError,
} from "../src/transport/index.ts";

// remote 계획 W5: wss:// 클라이언트 전송과 TLS 지문 고정. 임시 자체 서명 인증서(openssl)와 루프백 Bun.serve로 확인한다.
// openssl이 없으면 전체를 건너뛴다.

const hasOpenssl = Bun.which("openssl") !== null;
const JSON_LINE: JsonRpcMessage = { jsonrpc: "2.0", method: "x", params: {} };

interface Seen {
  readonly authorization: string | null;
  readonly origin: string | null;
}

interface Gateway {
  readonly port: number;
  /** fetch(업그레이드 요청)를 받을 때마다 쌓인다 */
  readonly seen: Seen[];
}

type Behavior = "echo" | "split" | "hang";

function derOf(pem: string): Buffer {
  const body = pem
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("-----"))
    .join("");
  return Buffer.from(body, "base64");
}

function sha256Hex(der: Buffer): string {
  return createHash("sha256").update(der).digest("hex");
}

/** 64자리 소문자 16진수를 `AB:CD:…` 꼴로 바꾼다(사용자가 붙여 넣는 모양) */
function colonHex(hex: string): string {
  return (hex.match(/../g) ?? []).map((pair) => pair.toUpperCase()).join(":");
}

/** 서버의 포트. 포트 0으로 열었으므로 값이 있어야 한다 */
function portOf(listener: { readonly port: number | undefined }): number {
  if (listener.port === undefined) throw new Error("listener has no port");
  return listener.port;
}

/** 지금 아무도 듣지 않는 포트. 닫은 뒤의 번호를 쓴다 */
async function closedPort(): Promise<number> {
  const listener = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = portOf(listener);
  await listener.stop(true);
  return port;
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** transport.onMessage로 메시지 `count`개를 받아 돌려준다 */
function nextMessages(transport: Transport, count: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const got: unknown[] = [];
    const unsubscribe = transport.onMessage((message) => {
      got.push(message);
      if (got.length === count) {
        unsubscribe();
        resolve(got);
      }
    });
  });
}

describe.skipIf(!hasOpenssl)("wss transport", () => {
  let dir = "";
  let certPem = "";
  let keyPem = "";
  // Server.stop은 Promise를, TCPSocketListener.stop은 값 없음을 돌려준다
  const closers: (() => unknown)[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ws-tls-"));
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    const proc = Bun.spawn(
      [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`openssl exited ${String(code)}`);
    certPem = readFileSync(certPath, "utf8");
    keyPem = readFileSync(keyPath, "utf8");
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  /** 루프백 게이트웨이. 인증은 `Bearer good`만 통과한다 */
  function startGateway(useTls: boolean, behavior: Behavior): Gateway {
    const seen: Seen[] = [];
    const listener = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(useTls ? { tls: { cert: certPem, key: keyPem } } : {}),
      fetch(request, server) {
        seen.push({
          authorization: request.headers.get("authorization"),
          origin: request.headers.get("origin"),
        });
        if (behavior === "hang") return new Promise<Response>(() => {});
        if (
          request.headers.get("authorization") !== "Bearer good" ||
          request.headers.get("origin") === null
        ) {
          return new Response("unauthorized", { status: 401 });
        }
        return server.upgrade(request) ? undefined : new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          if (behavior !== "split") return;
          // 한 줄을 두 메시지로 나누고, 두 줄을 한 메시지에 담는다
          ws.send('{"jsonrpc":"2.0",');
          ws.send('"method":"a","params":{}}\n');
          ws.send(
            '{"jsonrpc":"2.0","method":"b","params":{}}\n{"jsonrpc":"2.0","method":"c","params":{}}\n',
          );
        },
        message(ws, message) {
          if (behavior === "echo") ws.send(message);
        },
      },
    });
    closers.push(() => listener.stop(true));
    return { port: portOf(listener), seen };
  }

  /** 핸드셰이크에 답하지 않는 TCP 포트 */
  function startSilentTcp(): number {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {},
        data() {},
      },
    });
    closers.push(() => {
      listener.stop(true);
    });
    return listener.port;
  }

  function track(transport: Transport): Transport {
    closers.push(() => transport.close());
    return transport;
  }

  describe("probeTlsFingerprint", () => {
    test("reports the SHA-256 of the presented DER certificate and its PEM", async () => {
      const gateway = startGateway(true, "echo");
      const probed: TlsProbe = valueOf(
        await probeTlsFingerprint({ host: "127.0.0.1", port: gateway.port }),
      );
      expect(probed.fingerprint).toBe(sha256Hex(derOf(certPem)));
      expect(probed.pem).toBe(certPem);
    });

    test("a port with nothing listening is refused", async () => {
      const port = await closedPort();
      const refused: WsError = { kind: "refused", host: "127.0.0.1", port };
      const result = await probeTlsFingerprint({ host: "127.0.0.1", port });
      expect(result).toEqual({ ok: false, error: refused });
    });

    test("a server that never answers the handshake times out", async () => {
      const port = startSilentTcp();
      const result = await probeTlsFingerprint({ host: "127.0.0.1", port, timeoutMs: 200 });
      expect(result).toEqual({ ok: false, error: { kind: "timeout" } });
    });
  });

  describe("connectWebSocket with a pin", () => {
    test("connects when the pin matches, sends Authorization and Origin, and a JSON line round-trips", async () => {
      const gateway = startGateway(true, "echo");
      const fingerprint = sha256Hex(derOf(certPem));
      const transport = track(
        valueOf(
          await connectWebSocket({
            host: "127.0.0.1",
            port: gateway.port,
            pin: fingerprint,
            token: "good",
          }),
        ),
      );
      expect(transport.kind).toBe("socket");
      const received = nextMessages(transport, 1);
      await transport.send(JSON_LINE);
      expect(await received).toEqual([JSON_LINE]);
      expect(gateway.seen).toEqual([
        { authorization: "Bearer good", origin: `https://127.0.0.1:${String(gateway.port)}` },
      ]);
    });

    test("a line split over two messages and two lines in one message arrive whole and in order", async () => {
      const gateway = startGateway(true, "split");
      const transport = track(
        valueOf(
          await connectWebSocket({
            host: "127.0.0.1",
            port: gateway.port,
            pin: sha256Hex(derOf(certPem)),
            token: "good",
          }),
        ),
      );
      expect(await nextMessages(transport, 3)).toEqual([
        { jsonrpc: "2.0", method: "a", params: {} },
        { jsonrpc: "2.0", method: "b", params: {} },
        { jsonrpc: "2.0", method: "c", params: {} },
      ]);
    });

    test("a pin that differs is fingerprint_changed, and no upgrade request is sent", async () => {
      const gateway = startGateway(true, "echo");
      const actual = sha256Hex(derOf(certPem));
      const expected = "ab".repeat(32);
      const result = await connectWebSocket({
        host: "127.0.0.1",
        port: gateway.port,
        pin: expected,
        token: "good",
      });
      const mismatch: WsError = { kind: "fingerprint_changed", expected, actual };
      expect(result).toEqual({ ok: false, error: mismatch });
      expect(gateway.seen).toEqual([]);
    });

    test("an uppercase pin with colon separators is accepted", async () => {
      const gateway = startGateway(true, "echo");
      const transport = track(
        valueOf(
          await connectWebSocket({
            host: "127.0.0.1",
            port: gateway.port,
            pin: colonHex(sha256Hex(derOf(certPem))),
            token: "good",
          }),
        ),
      );
      const received = nextMessages(transport, 1);
      await transport.send(JSON_LINE);
      expect(await received).toEqual([JSON_LINE]);
    });

    test("a wrong token is upgrade_rejected", async () => {
      const gateway = startGateway(true, "echo");
      const result = await connectWebSocket({
        host: "127.0.0.1",
        port: gateway.port,
        pin: sha256Hex(derOf(certPem)),
        token: "bad",
      });
      expect(result).toEqual({ ok: false, error: { kind: "upgrade_rejected" } });
    });

    test("a server that never completes the upgrade times out", async () => {
      const gateway = startGateway(true, "hang");
      const result = await connectWebSocket({
        host: "127.0.0.1",
        port: gateway.port,
        pin: sha256Hex(derOf(certPem)),
        token: "good",
        connectTimeoutMs: 300,
      });
      expect(result).toEqual({ ok: false, error: { kind: "timeout" } });
    });

    test("a malformed pin is invalid_pin and nothing is sent", async () => {
      const gateway = startGateway(true, "echo");
      const result = await connectWebSocket({
        host: "127.0.0.1",
        port: gateway.port,
        pin: "zz",
        token: "good",
      });
      expect(result).toEqual({ ok: false, error: { kind: "io", code: "invalid_pin" } });
      expect(gateway.seen).toEqual([]);
    });
  });

  describe("connectWebSocket without a pin", () => {
    test("a self-signed certificate is tls_untrusted with its fingerprint, and no upgrade request is sent", async () => {
      const gateway = startGateway(true, "echo");
      const result = await connectWebSocket({
        host: "127.0.0.1",
        port: gateway.port,
        token: "good",
      });
      expect(result).toEqual({
        ok: false,
        error: { kind: "tls_untrusted", fingerprint: sha256Hex(derOf(certPem)) },
      });
      expect(gateway.seen).toEqual([]);
    });

    test("a port with nothing listening is refused", async () => {
      const port = await closedPort();
      const refused: WsError = { kind: "refused", host: "127.0.0.1", port };
      const result = await connectWebSocket({ host: "127.0.0.1", port });
      expect(result).toEqual({ ok: false, error: refused });
    });
  });

  describe("plaintext", () => {
    test("tls false with a non-loopback host is plaintext_not_loopback", async () => {
      const result = await connectWebSocket({ host: "example.com", port: 80, tls: false });
      expect(result).toEqual({
        ok: false,
        error: { kind: "plaintext_not_loopback", host: "example.com" },
      });
    });

    test("tls false on loopback works over ws:// with an http Origin", async () => {
      const gateway = startGateway(false, "echo");
      const transport = track(
        valueOf(
          await connectWebSocket({
            host: "127.0.0.1",
            port: gateway.port,
            tls: false,
            token: "good",
          }),
        ),
      );
      const received = nextMessages(transport, 1);
      await transport.send(JSON_LINE);
      expect(await received).toEqual([JSON_LINE]);
      expect(gateway.seen).toEqual([
        { authorization: "Bearer good", origin: `http://127.0.0.1:${String(gateway.port)}` },
      ]);
    });

    test("a pin with tls false is pin_without_tls and nothing is sent", async () => {
      const gateway = startGateway(false, "echo");
      const options: WsConnectOptions = {
        host: "127.0.0.1",
        port: gateway.port,
        tls: false,
        pin: sha256Hex(derOf(certPem)),
      };
      expect(await connectWebSocket(options)).toEqual({
        ok: false,
        error: { kind: "io", code: "pin_without_tls" },
      });
      expect(gateway.seen).toEqual([]);
    });
  });
});
