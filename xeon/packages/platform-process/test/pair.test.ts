import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import { pairWithGateway, type PairOptions } from "../src/transport/index.ts";

// remote 계획: 데스크톱의 페어링 요청(`POST /pair`)과 지문 고정. ws.test.ts와 같은 방식으로 임시 자체 서명 인증서(openssl)와 Bun.serve TLS 서버를 쓴다.
// openssl이 없으면 서버가 필요한 시험을 건너뛴다. 입력 검사 시험은 서버가 필요 없어 항상 돈다.
// 시험용 토큰과 코드는 가짜 값이다.

const CODE = "ABCD-EFGH";
const DEVICE_NAME = "test-desktop";
const TOKEN = "tok-test-not-a-secret";
const SUCCESS = { ok: true, device: { id: "dev-1", name: DEVICE_NAME }, token: TOKEN };
const UNUSED_PIN = "ab".repeat(32);
const hasOpenssl = Bun.which("openssl") !== null;

interface TlsMaterial {
  readonly certPem: string;
  readonly keyPem: string;
  readonly fingerprint: string;
}

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly origin: string | null;
  readonly contentType: string | null;
  /** 본문이 JSON이면 값, 아니면 원문 */
  readonly body: unknown;
}

/** 서버가 보낼 응답. "hang"이면 응답하지 않는다 */
type Reply =
  | { readonly status: number; readonly body: string; readonly headers: Record<string, string> }
  | "hang";

interface PairServer {
  readonly port: number;
  /** 요청이 올 때마다 쌓인다. 지문 재기(TLS만)에는 쌓이지 않는다 */
  readonly seen: Seen[];
}

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

/** JSON 본문 응답 */
function json(status: number, value: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body: JSON.stringify(value), headers };
}

/** 원문 본문 응답 */
function raw(status: number, body: string, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

/** 지금 아무도 듣지 않는 포트. 닫은 뒤의 번호를 쓴다 */
async function closedPort(): Promise<number> {
  const listener = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = listener.port;
  if (port === undefined) throw new Error("listener has no port");
  await listener.stop(true);
  return port;
}

async function makeTls(dir: string, name: string): Promise<TlsMaterial> {
  const keyPath = join(dir, `${name}-key.pem`);
  const certPath = join(dir, `${name}-cert.pem`);
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
  const certPem = readFileSync(certPath, "utf8");
  return {
    certPem,
    keyPem: readFileSync(keyPath, "utf8"),
    fingerprint: sha256Hex(derOf(certPem)),
  };
}

describe("pairWithGateway input checks", () => {
  // 모든 입력 검사는 서버 호출 전에 끝난다. 포트 9는 쓰이지 않는다(쓰였다면 refused가 나온다)
  const base: PairOptions = {
    host: "127.0.0.1",
    port: 9,
    pin: UNUSED_PIN,
    code: CODE,
    deviceName: DEVICE_NAME,
  };

  test.each(["", "zz", "ab".repeat(31), "ab".repeat(33), "g".repeat(64)])(
    "pin %s is invalid_pin",
    async (pin) => {
      expect(await pairWithGateway({ ...base, pin })).toEqual({
        ok: false,
        error: { kind: "invalid_pin" },
      });
    },
  );

  test.each(["", "bad host", "a/b", "tab\there", "a?b", "user@host", "[::1", "example.com:443"])(
    "host %s is invalid_host",
    async (host) => {
      expect(await pairWithGateway({ ...base, host })).toEqual({
        ok: false,
        error: { kind: "invalid_host" },
      });
    },
  );

  test.each([0, 65_536, -1, 1.5])("port %p is invalid_port", async (port) => {
    expect(await pairWithGateway({ ...base, port })).toEqual({
      ok: false,
      error: { kind: "invalid_port" },
    });
  });

  test.each(["", "x".repeat(65)])("a code of length %p is invalid_code_format", async (code) => {
    expect(await pairWithGateway({ ...base, code })).toEqual({
      ok: false,
      error: { kind: "invalid_code_format" },
    });
  });
});

describe.skipIf(!hasOpenssl)("pairWithGateway", () => {
  let dir = "";
  let certA: TlsMaterial = { certPem: "", keyPem: "", fingerprint: "" };
  let certB: TlsMaterial = { certPem: "", keyPem: "", fingerprint: "" };
  // Server.stop은 Promise를, TCPSocketListener.stop은 값 없음을 돌려준다
  const closers: (() => unknown)[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pair-tls-"));
    certA = await makeTls(dir, "a");
    certB = await makeTls(dir, "b");
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  /** 한 가지 응답만 내는 TLS 게이트웨이. 요청을 기록한다 */
  function startPairServer(tls: TlsMaterial, reply: Reply, hostname = "127.0.0.1"): PairServer {
    const seen: Seen[] = [];
    const listener = Bun.serve({
      port: 0,
      hostname,
      tls: { cert: tls.certPem, key: tls.keyPem },
      async fetch(request) {
        const text = await request.text();
        const parsed = parseJson(text);
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
          origin: request.headers.get("origin"),
          contentType: request.headers.get("content-type"),
          body: parsed.ok ? parsed.value : text,
        });
        if (reply === "hang") return new Promise<Response>(() => {});
        return new Response(reply.body, {
          status: reply.status,
          headers: { "content-type": "application/json", ...reply.headers },
        });
      },
    });
    closers.push(() => listener.stop(true));
    const port = listener.port;
    if (port === undefined) throw new Error("listener has no port");
    return { port, seen };
  }

  function optionsFor(port: number, overrides: Partial<PairOptions> = {}): PairOptions {
    return {
      host: "127.0.0.1",
      port,
      pin: certA.fingerprint,
      code: CODE,
      deviceName: DEVICE_NAME,
      ...overrides,
    };
  }

  test("sends POST /pair with the Origin, JSON body, and returns the token and device", async () => {
    const server = startPairServer(certA, json(200, SUCCESS));
    const result = await pairWithGateway(optionsFor(server.port));
    expect(result).toEqual({
      ok: true,
      value: { token: TOKEN, deviceId: "dev-1", deviceName: DEVICE_NAME },
    });
    expect(server.seen).toEqual([
      {
        method: "POST",
        path: "/pair",
        origin: `https://127.0.0.1:${String(server.port)}`,
        contentType: "application/json",
        body: { code: CODE, deviceName: DEVICE_NAME, kind: "desktop" },
      },
    ]);
  });

  test("an uppercase pin with colon separators is accepted", async () => {
    const server = startPairServer(certA, json(200, SUCCESS));
    const colons = (certA.fingerprint.match(/../g) ?? [])
      .map((pair) => pair.toUpperCase())
      .join(":");
    const result = await pairWithGateway(optionsFor(server.port, { pin: colons }));
    expect(result.ok).toBe(true);
    expect(server.seen).toHaveLength(1);
  });

  test("an IPv6 host is bracketed in the Origin header", async () => {
    const server = startPairServer(certA, json(200, SUCCESS), "::1");
    const result = await pairWithGateway(optionsFor(server.port, { host: "::1" }));
    expect(result.ok).toBe(true);
    expect(server.seen.map((seen) => seen.origin)).toEqual([
      `https://[::1]:${String(server.port)}`,
    ]);
  });

  test("a pin that differs from the certificate is fingerprint_changed, and no request is sent", async () => {
    const server = startPairServer(certA, json(200, SUCCESS));
    const result = await pairWithGateway(optionsFor(server.port, { pin: UNUSED_PIN }));
    expect(result).toEqual({
      ok: false,
      error: { kind: "fingerprint_changed", expected: UNUSED_PIN, actual: certA.fingerprint },
    });
    expect(server.seen).toEqual([]);
  });

  test("a server that changed its certificate after pinning is fingerprint_changed", async () => {
    const server = startPairServer(certB, json(200, SUCCESS));
    const result = await pairWithGateway(optionsFor(server.port, { pin: certA.fingerprint }));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "fingerprint_changed",
        expected: certA.fingerprint,
        actual: certB.fingerprint,
      },
    });
    expect(server.seen).toEqual([]);
  });

  test("401 invalid_code is invalid_code", async () => {
    const server = startPairServer(certA, json(401, { error: "invalid_code" }));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "invalid_code" },
    });
  });

  test("429 locked carries retryAfterSeconds from the retry-after header", async () => {
    const server = startPairServer(certA, json(429, { error: "locked" }, { "retry-after": "42" }));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "locked", retryAfterSeconds: 42 },
    });
  });

  test("429 locked without a usable retry-after header is bad_response", async () => {
    const server = startPairServer(certA, json(429, { error: "locked" }));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  test("400 invalid_device_name is invalid_device_name", async () => {
    const server = startPairServer(certA, json(400, { error: "invalid_device_name" }));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "invalid_device_name" },
    });
  });

  test("400 invalid_body is rejected with its status", async () => {
    const server = startPairServer(certA, json(400, { error: "invalid_body" }));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "rejected", status: 400 },
    });
  });

  test.each([403, 421, 500])("status %p is rejected with its status", async (status) => {
    const server = startPairServer(certA, raw(status, "{}"));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "rejected", status },
    });
  });

  test("a 200 body that is not JSON is bad_response", async () => {
    const server = startPairServer(certA, raw(200, "not json{"));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  test("a 200 body with an empty token is bad_response", async () => {
    const server = startPairServer(
      certA,
      json(200, { ok: true, device: { id: "dev-1", name: DEVICE_NAME }, token: "" }),
    );
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  test("a response body over 64KB is bad_response", async () => {
    const server = startPairServer(certA, raw(200, "x".repeat(64 * 1024 + 1)));
    expect(await pairWithGateway(optionsFor(server.port))).toEqual({
      ok: false,
      error: { kind: "bad_response" },
    });
  });

  test("a port with nothing listening is refused", async () => {
    const port = await closedPort();
    expect(await pairWithGateway(optionsFor(port))).toEqual({
      ok: false,
      error: { kind: "refused", host: "127.0.0.1", port },
    });
  });

  test("a server that never answers the request times out", async () => {
    const server = startPairServer(certA, "hang");
    expect(await pairWithGateway(optionsFor(server.port, { timeoutMs: 300 }))).toEqual({
      ok: false,
      error: { kind: "timeout" },
    });
  });
});
