// 게이트웨이 시험의 공용 대역: 임시 UI·정적 폴더, 실제 Unix 소켓의 가짜 서비스, 기록하는 세션 공장과 푸시,
// 게이트웨이 조립, 그리고 HTTP·HTTPS·WebSocket 호출. 시험 본문은 이 파일의 함수를 거쳐 게이트웨이에 닿는다.
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import path from "node:path";
import { TLSSocket, connect as tlsConnect } from "node:tls";
import { err, ok, type Clock, type Result } from "@fresnel/contracts";
import { createAuthPort, type AuthPort } from "../../../src/web/auth/auth-port.ts";
import type { DeviceInfo } from "../../../src/web/auth/devices.ts";
import {
  createGateway,
  type Gateway,
  type GatewayError,
  type GatewayInfo,
  type TlsListenerOptions,
} from "../../../src/web/server/gateway.ts";
import { buildLoginSource } from "../../../src/web/server/login-bundle.ts";
import { connectServiceSocket } from "../../../src/web/server/service-connection.ts";
import type { PushService, PushSubscribeError } from "../../../src/web/server/ports.ts";
import type {
  TabSession,
  TabSessionFactory,
  TabSessionInput,
} from "../../../src/web/session/ports.ts";
import { prepareTls, type TlsMaterial } from "../../../src/web/tls/store.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "../support/fixtures.ts";
import { recordingLogger, type RecordingLogger } from "../support/logger.ts";

export { cleanupTempDirs };

export const SHIM_TEXT = 'window.fresnelShell = { version: "test" };';
export const SW_TEXT = 'self.addEventListener("install", () => {});';
export const LOGIN_TEXT = 'console.log("login");';
export const PUSH_KEY = "BPushPublicKeyForTests";
export const LOGIN_HTML: string =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Login</title>' +
  '<link rel="stylesheet" href="/login.css"></head><body><form id="pair-form"></form>' +
  '<script src="/login.js" defer></script></body></html>\n';
const INDEX_HTML: string =
  '<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8"><title>Fresnel</title></head>\n' +
  '  <body><div id="root"></div><script type="module" src="./assets/app.js"></script></body>\n</html>\n';
/** 셸 태그를 넣은 뒤의 index.html(시험의 기대 값) */
export const INDEX_WITH_SHIM: string = INDEX_HTML.replace(
  "<head>",
  '<head><script src="/shell/shim.js"></script>',
);

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function jsonOf(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/* ---------- 기록하는 세션 공장과 푸시 ---------- */

interface SessionRecord {
  readonly input: TabSessionInput;
  readonly received: string[];
  closeCalls: number;
}

interface FakeSessions {
  readonly factory: TabSessionFactory;
  readonly opened: SessionRecord[];
}

function fakeSessions(): FakeSessions {
  const opened: SessionRecord[] = [];
  const factory: TabSessionFactory = {
    open(input) {
      const record: SessionRecord = { input, received: [], closeCalls: 0 };
      opened.push(record);
      const session: TabSession = {
        receive(text) {
          record.received.push(text);
        },
        close() {
          record.closeCalls += 1;
        },
      };
      return session;
    },
  };
  return { factory, opened };
}

interface PushCall {
  readonly deviceId: string;
  readonly body: unknown;
}

interface FakePush {
  readonly service: PushService;
  readonly calls: PushCall[];
  readonly state: { failWith: PushSubscribeError | null };
}

function fakePush(): FakePush {
  const calls: PushCall[] = [];
  const state: { failWith: PushSubscribeError | null } = { failWith: null };
  const service: PushService = {
    vapidPublicKey: () => PUSH_KEY,
    subscribe(deviceId, body) {
      calls.push({ deviceId, body });
      const failure = state.failWith;
      return failure === null ? ok(null) : err(failure);
    },
  };
  return { service, calls, state };
}

/* ---------- 가짜 서비스: 실제 Unix 소켓 ---------- */

export interface ServiceSide {
  readonly socket: Socket;
  readonly received: Buffer[];
  /** 서비스 쪽 소켓이 닫히면 풀린다 */
  readonly closed: Promise<void>;
}

export interface FakeService {
  readonly path: string;
  /** 게이트웨이가 연결해 온 순서대로 쌓인다 */
  readonly sides: ServiceSide[];
  close(): Promise<void>;
}

export async function startFakeService(dir: string): Promise<FakeService> {
  const socketPath = path.join(dir, "s.sock");
  const sides: ServiceSide[] = [];
  const server: NetServer = createNetServer((socket) => {
    const received: Buffer[] = [];
    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
    });
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk);
    });
    socket.on("error", () => {
      // 게이트웨이가 먼저 닫으면 ECONNRESET이 날 수 있다. 시험은 `closed`로 닫힘을 본다
    });
    sides.push({ socket, received, closed });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  return {
    path: socketPath,
    sides,
    async close() {
      for (const side of sides) side.socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** 서비스 쪽 소켓이 받은 바이트를 모두 이어 붙인다 */
export function receivedBytes(side: ServiceSide): Buffer {
  return Buffer.concat(side.received);
}

/* ---------- 게이트웨이 조립 ---------- */

export interface HarnessOptions {
  /** 기본 true. false면 `/push/*`가 404다 */
  readonly push?: boolean;
  /** 기본 false. true면 TLS 리스너를 빈 포트에 연다(호스트 `localhost`) */
  readonly tls?: boolean;
  /** 기본 true. false면 루프백 리스너를 열지 않는다 */
  readonly loopback?: boolean;
  /** 기본 false. true면 실제 `login.ts` 묶음을 쓴다(느리다) */
  readonly realLogin?: boolean;
  /** 인증 부품을 감싼다(실패를 흉내 낸다) */
  readonly auth?: (real: AuthPort) => AuthPort;
  /** 로그인 스크립트 글자를 직접 준다(실패를 흉내 낸다) */
  readonly loginSource?: () => Promise<Result<string, unknown>>;
  /** true면 `start()`가 실패해도 던지지 않고 `startError`에 담아 돌려준다 */
  readonly expectStartError?: boolean;
}

export interface Harness {
  readonly gateway: Gateway;
  readonly auth: AuthPort;
  readonly sessions: SessionRecord[];
  readonly push: FakePush;
  readonly service: FakeService;
  readonly logger: RecordingLogger;
  readonly clock: Clock;
  readonly uiDir: string;
  readonly staticDir: string;
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly tlsMaterial: TlsMaterial | null;
  /** 루프백 HTTP의 기준 출처 */
  readonly origin: string;
  /** `start()`가 실패했으면 그 오류(`expectStartError`일 때만 남는다) */
  readonly startError: GatewayError | null;
  stop(): Promise<void>;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = tempDir();
  const uiDir = path.join(root, "ui");
  const staticDir = path.join(root, "static");
  mkdirSync(path.join(uiDir, "assets"), { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(uiDir, "index.html"), INDEX_HTML);
  writeFileSync(path.join(uiDir, "assets", "app.js"), 'export const app = "fresnel";\n');
  writeFileSync(path.join(uiDir, "assets", "app.css"), "body { margin: 0; }\n");
  writeFileSync(path.join(uiDir, ".hidden"), "secret\n");
  writeFileSync(path.join(uiDir, "assets", ".env"), "TOKEN=1\n");
  // 루트 밖을 가리키는 심볼릭 링크: 실제 경로 검사가 막아야 한다
  const outside = path.join(root, "outside.txt");
  writeFileSync(outside, "outside the ui\n");
  symlinkSync(outside, path.join(uiDir, "leak.txt"));
  writeFileSync(path.join(staticDir, "login.html"), LOGIN_HTML);
  writeFileSync(path.join(staticDir, "login.css"), "body { margin: 0; }\n");

  const clock = manualClock();
  const logger = recordingLogger();
  const made = createAuthPort({
    dir: path.join(root, "remote"),
    clock,
    logger,
    randomBytes: sequenceBytes(3),
  });
  if (!made.ok) throw new Error(`auth port did not open: ${made.error.kind}`);
  const auth = options.auth === undefined ? made.value : options.auth(made.value);

  const service = await startFakeService(root);

  let tlsListener: TlsListenerOptions | null = null;
  let tlsMaterial: TlsMaterial | null = null;
  if (options.tls === true) {
    const material = prepareTls({ dir: path.join(root, "tls"), hosts: ["localhost"], clock });
    if (!material.ok) throw new Error(`tls material: ${material.error.kind}`);
    tlsMaterial = material.value;
    tlsListener = { host: "127.0.0.1", port: 0, hosts: ["localhost"], material: material.value };
  }

  const sessions = fakeSessions();
  const push = fakePush();
  const loginSource =
    options.loginSource ??
    (options.realLogin === true ? buildLoginSource : () => Promise.resolve(ok(LOGIN_TEXT)));
  const gateway = createGateway({
    auth,
    sessions: sessions.factory,
    push: options.push === false ? null : push.service,
    shim: () => Promise.resolve(SHIM_TEXT),
    uiDir,
    staticDir,
    serviceWorkerSource: () => Promise.resolve(SW_TEXT),
    loginSource,
    serviceSocketPath: service.path,
    connectService: connectServiceSocket,
    loopback: options.loopback === false ? null : { port: 0 },
    tls: tlsListener,
    clock,
    logger,
  });
  const started = await gateway.start();
  if (!started.ok && options.expectStartError !== true) {
    throw new Error(`gateway did not start: ${started.error.kind}`);
  }
  const info: GatewayInfo | null = started.ok ? started.value : null;
  const loopbackPort = info?.loopbackPort ?? null;

  return {
    gateway,
    auth,
    sessions: sessions.opened,
    push,
    service,
    logger,
    clock,
    uiDir,
    staticDir,
    loopbackPort,
    tlsPort: info?.tlsPort ?? null,
    tlsMaterial,
    origin: loopbackPort === null ? "" : `http://127.0.0.1:${String(loopbackPort)}`,
    startError: started.ok ? null : started.error,
    async stop() {
      await gateway.stop();
      await service.close();
    },
  };
}

/* ---------- 페어링 도우미 ---------- */

export interface PairedWeb {
  readonly deviceId: string;
  /** `Cookie` 헤더에 그대로 넣는 값(`이름=토큰`) */
  readonly cookie: string;
}

/** 코드를 만들고 `POST /pair`로 웹 기기를 페어링한다. 응답이 200이 아니면 던진다(시험 준비의 실패) */
export async function pairWeb(
  harness: Harness,
  origin: string,
  name = "Tab",
  host = `127.0.0.1:${String(harness.loopbackPort ?? 0)}`,
): Promise<PairedWeb> {
  const issued = harness.auth.createPairingCode();
  const res = await rawHttp({
    port: harness.loopbackPort ?? 0,
    method: "POST",
    path: "/pair",
    headers: { host, origin, "content-type": "application/json" },
    body: JSON.stringify({ code: issued.code, deviceName: name, kind: "web" }),
  });
  if (res.status !== 200) throw new Error(`pairing failed: ${String(res.status)} ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (first === undefined) throw new Error("pairing did not set a cookie");
  const device = harness.auth.listDevices().find((item) => item.name === name);
  if (device === undefined) throw new Error("paired device is not listed");
  return { deviceId: device.id, cookie: first.split(";")[0] ?? "" };
}

export function deviceNamed(harness: Harness, name: string): DeviceInfo | undefined {
  return harness.auth.listDevices().find((item) => item.name === name);
}

/* ---------- HTTP 호출 (node:http: Host와 경로를 그대로 보낸다) ---------- */

export interface RawRequest {
  readonly port: number;
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export function rawHttp(request: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: request.port,
        method: request.method ?? "GET",
        path: request.path,
        headers: request.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(request.body);
  });
}

/** HTTP/1.1 WebSocket 업그레이드 요청의 상태만 본다(101이면 소켓을 닫는다). 거절 응답의 본문도 같이 준다 */
export function rawUpgrade(
  request: Omit<RawRequest, "method" | "body">,
): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: request.port,
      method: "GET",
      path: request.path,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...request.headers,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode ?? 0, body: "" });
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/* ---------- HTTPS 호출(자체 서명: 지문을 직접 비교한다) ---------- */

export interface TlsResponse extends RawResponse {
  /** 연결된 TLS 버전(예: `TLSv1.3`) */
  readonly protocol: string | null;
  /** 서버가 내민 인증서 DER의 SHA-256 */
  readonly fingerprint: string | null;
}

export function httpsRaw(
  request: RawRequest & { readonly maxVersion?: "TLSv1.2" },
): Promise<TlsResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: request.port,
        method: request.method ?? "GET",
        path: request.path,
        headers: request.headers ?? {},
        servername: "localhost",
        rejectUnauthorized: false,
        ...(request.maxVersion === undefined ? {} : { maxVersion: request.maxVersion }),
      },
      (res) => {
        const socket = res.socket;
        const protocol = socket instanceof TLSSocket ? socket.getProtocol() : null;
        const peer = socket instanceof TLSSocket ? socket.getPeerCertificate() : null;
        const fingerprint =
          peer === null || !Buffer.isBuffer(peer.raw) ? null : sha256Hex(peer.raw);
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            protocol: protocol ?? null,
            fingerprint,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(request.body);
  });
}

/** TLS 핸드셰이크만 해 본다. 버전 범위를 좁히면 거절되는지 본다 */
export function tlsHandshake(
  port: number,
  versions: { readonly min?: "TLSv1.2" | "TLSv1.3"; readonly max?: "TLSv1.2" | "TLSv1.3" },
): Promise<{ readonly protocol: string | null; readonly errorCode: string | null }> {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: "127.0.0.1",
      port,
      servername: "localhost",
      rejectUnauthorized: false,
      ...(versions.min === undefined ? {} : { minVersion: versions.min }),
      ...(versions.max === undefined ? {} : { maxVersion: versions.max }),
    });
    socket.once("secureConnect", () => {
      const protocol = socket.getProtocol();
      socket.destroy();
      resolve({ protocol: protocol ?? null, errorCode: null });
    });
    socket.once("error", (caught: unknown) => {
      socket.destroy();
      resolve({ protocol: null, errorCode: codeOf(caught) });
    });
  });
}

/* ---------- WebSocket 호출(Bun 클라이언트: 메시지를 큐로 받는다) ---------- */

export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
}

export interface TestSocket {
  readonly ws: WebSocket;
  /** 다음 메시지(텍스트 또는 ArrayBuffer)를 기다린다 */
  next(): Promise<string | ArrayBuffer>;
  readonly closed: Promise<CloseInfo>;
}

export function openSocket(
  url: string,
  headers: Readonly<Record<string, string>>,
  init: { readonly tls?: boolean } = {},
): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    // 전역 `WebSocket`의 타입은 DOM 라이브러리(로그인 스크립트 때문에 켰다)가 이겨서 Bun의 `headers` 생성자 형태가 안 보인다.
    // 같은 생성자를 `Reflect.construct`로 불러 `unknown`으로 받고 `instanceof`로 좁힌다(단언을 쓰지 않는다)
    const options: Bun.WebSocketOptions =
      init.tls === true
        ? { headers: { ...headers }, tls: { rejectUnauthorized: false } }
        : { headers: { ...headers } };
    const built: unknown = Reflect.construct(WebSocket, [url, options]);
    if (!(built instanceof WebSocket)) {
      reject(new Error(`websocket client for ${url} was not constructed`));
      return;
    }
    const ws = built;
    ws.binaryType = "arraybuffer";
    const inbox: (string | ArrayBuffer)[] = [];
    const waiting: ((message: string | ArrayBuffer) => void)[] = [];
    ws.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (typeof data !== "string" && !(data instanceof ArrayBuffer)) return;
      const waiter = waiting.shift();
      if (waiter === undefined) inbox.push(data);
      else waiter(data);
    });
    const closed = new Promise<CloseInfo>((_resolve) => {
      ws.addEventListener("close", (event) => {
        _resolve({ code: event.code, reason: event.reason });
      });
    });
    ws.addEventListener("open", () => {
      resolve({
        ws,
        next() {
          const queued = inbox.shift();
          if (queued !== undefined) return Promise.resolve(queued);
          return new Promise((_resolve) => {
            waiting.push(_resolve);
          });
        },
        closed,
      });
    });
    ws.addEventListener("error", () => {
      reject(new Error(`websocket to ${url} failed`));
    });
  });
}

/** 앞 항목이 끝난 뒤에 다음 항목을 실행한다. 실패 횟수처럼 호출 순서가 결과를 정하는 시험에 쓴다 */
export function inOrder<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    (previous, item) => previous.then(async (done) => [...done, await run(item)]),
    Promise.resolve([]),
  );
}

/** 시간이 지나도록 값이 바뀌지 않음을 확인할 때 쓴다(연결이 아무 일도 하지 않는 것을 본다) */
export function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
