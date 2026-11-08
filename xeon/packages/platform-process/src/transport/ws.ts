import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { attempt, detach, err, ok, type Logger, type Result } from "@fresnel/contracts";
import { createStdioTransportWith, type Transport } from "@fresnel/contracts/wire";
import { isLoopbackHost } from "./socket.ts";

// remote 계획 W5. 데스크톱이 다른 컴퓨터의 게이트웨이 `/wire`에 wss://로 붙는 클라이언트 전송.
// - 신뢰는 지문 고정이다. pin이 있으면 먼저 지문을 재고, 같을 때만 그 인증서 하나를 유일한 CA로 WebSocket을 연다.
//   재는 때와 여는 때 사이에 인증서가 바뀌면 검증에서 막힌다. pin이 없으면 기본 검증을 쓰고, 실패하면 지문을 알려 준다.
// - 프레이밍은 stdio와 같다(createStdioTransportWith). 메시지 경계는 보지 않고 바이트를 이어 붙인다.
// - 전역 WebSocket은 Bun 1.4.3의 것만 쓴다. 외부 의존은 없다.

export type WsError =
  | { readonly kind: "refused"; readonly host: string; readonly port: number }
  | { readonly kind: "timeout" }
  /** pin이 없고 기본 인증서 검증이 실패했다. 지문은 사용자에게 보여 주는 값이고 신뢰 근거가 아니다 */
  | { readonly kind: "tls_untrusted"; readonly fingerprint: string }
  | { readonly kind: "fingerprint_changed"; readonly expected: string; readonly actual: string }
  /** TLS는 됐지만 HTTP 업그레이드가 101이 아니다(인증, Origin, Host 거부) */
  | { readonly kind: "upgrade_rejected" }
  | { readonly kind: "plaintext_not_loopback"; readonly host: string }
  /** code: ws_failed(연결 실패), tls_closed(핸드셰이크 전 끊김), invalid_pin, pin_without_tls, 그 밖에 노드 오류 코드 */
  | { readonly kind: "io"; readonly code: string };

export interface TlsProbe {
  /** 64자리 소문자 16진수. DER 인증서의 SHA-256 */
  readonly fingerprint: string;
  readonly pem: string;
}

export interface WsConnectOptions {
  readonly host: string;
  readonly port: number;
  /** 기본 "/wire" */
  readonly path?: string;
  /** 기본 true. false는 루프백 주소에서만 */
  readonly tls?: boolean;
  /** SHA-256 지문 64자리 16진수. 대소문자와 ':' 구분자는 무시한다. tls가 true일 때만 */
  readonly pin?: string;
  /** `Authorization: Bearer` 값. 로그와 URL과 오류에 넣지 않는다 */
  readonly token?: string;
  /** 비어 있으면 `https://host:port`(tls가 false면 `http://`). 게이트웨이는 Origin을 요구한다 */
  readonly origin?: string;
  readonly maxFrameBytes?: number;
  /** 기본 10000 */
  readonly connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_PATH = "/wire";
/** Bun WebSocket이 업그레이드 상태 거부를 알리는 문장 */
const UPGRADE_REJECTED_TEXT = "Expected 101";
const PIN_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "";
}

function textOf(event: Event): string {
  return "message" in event && typeof event.message === "string" ? event.message : "";
}

/** `[::1]` 꼴이면 괄호를 벗긴다. node:tls와 SNI는 괄호 없는 주소를 받는다 */
function bareHost(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 구분자 ':'를 빼고 소문자로 맞춘다. 64자리 16진수가 아니면 undefined */
function normalizePin(pin: string): string | undefined {
  const normalized = pin.replace(/:/g, "").toLowerCase();
  return PIN_PATTERN.test(normalized) ? normalized : undefined;
}

function sha256Hex(der: Buffer): string {
  return createHash("sha256").update(der).digest("hex");
}

function pemOf(der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----", ""].join("\n");
}

function tlsErrorOf(caught: unknown, host: string, port: number): WsError {
  const code = codeOf(caught);
  if (code === "ECONNREFUSED") return { kind: "refused", host, port };
  return { kind: "io", code };
}

/**
 * 서버가 내는 인증서의 지문과 PEM을 잰다. 검증은 하지 않고 연결은 바로 끊는다.
 * 신뢰 판단은 호출자가 지문으로 한다.
 */
export function probeTlsFingerprint(options: {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
}): Promise<Result<TlsProbe, WsError>> {
  const host = bareHost(options.host);
  return new Promise((resolve) => {
    const made = attempt(() =>
      tlsConnect({
        host,
        port: options.port,
        rejectUnauthorized: false,
        // IP 주소에는 servername을 주지 않는다(Bun은 IP servername을 거부한다)
        ...(isIP(host) === 0 ? { servername: host } : {}),
      }),
    );
    if (!made.ok) {
      resolve(err({ kind: "io", code: codeOf(made.error.cause) }));
      return;
    }
    const socket = made.value;
    const timer = setTimeout(() => {
      finish(err({ kind: "timeout" }));
    }, options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    const finish = (result: Result<TlsProbe, WsError>): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!Buffer.isBuffer(cert.raw)) {
        finish(err({ kind: "io", code: "no_peer_certificate" }));
        return;
      }
      finish(ok({ fingerprint: sha256Hex(cert.raw), pem: pemOf(cert.raw) }));
    });
    socket.on("error", (caught: unknown) => {
      finish(err(tlsErrorOf(caught, options.host, options.port)));
    });
    socket.on("close", () => {
      finish(err({ kind: "io", code: "tls_closed" }));
    });
  });
}

interface WsStreams {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

/** 열린 WebSocket 하나를 웹 스트림 쌍으로 바꾼다. 메시지는 받은 순서대로 바이트가 된다 */
function streamsOf(ws: WebSocket): WsStreams {
  const state = { done: false };
  // 함수로 읽어야 await 뒤의 검사가 앞 검사의 좁힘을 물려받지 않는다
  const isDone = (): boolean => state.done;
  // Blob은 비동기로 읽으므로 메시지마다 앞 메시지 뒤에 잇는다
  const inbox: { tail: Promise<void> } = { tail: Promise.resolve() };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (cause: unknown): void => {
        if (isDone()) return;
        state.done = true;
        controller.error(new Error("ws_stream_failed", { cause }));
      };
      const push = async (data: unknown): Promise<void> => {
        if (isDone()) return;
        if (typeof data === "string") {
          controller.enqueue(encoder.encode(data));
        } else if (data instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(data));
        } else if (data instanceof Blob) {
          const bytes = new Uint8Array(await data.arrayBuffer());
          if (!isDone()) controller.enqueue(bytes);
        } else {
          fail(new Error("ws_unexpected_data"));
        }
      };
      ws.addEventListener("message", (event) => {
        const data: unknown = event.data;
        inbox.tail = inbox.tail.then(() => push(data));
        detach(inbox.tail, fail);
      });
      ws.addEventListener("close", (event) => {
        if (state.done) return;
        state.done = true;
        if (event.wasClean) controller.close();
        else controller.error(new Error("ws_closed", { cause: event.reason }));
      });
      ws.addEventListener("error", (event) => {
        fail(new Error("ws_error", { cause: textOf(event) }));
      });
    },
    cancel() {
      state.done = true;
      ws.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      ws.send(chunk);
    },
    close() {
      ws.close(1000);
    },
  });
  return { readable, writable };
}

type DialFailure =
  | { readonly kind: "timeout" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * WebSocket을 연다. 스트림은 생성 직후(열리기 전)에 붙여 둔다. 열린 뒤 첫 메시지를 잃지 않으려고.
 * 열리기 전 실패는 시한이거나 WebSocket이 준 문장이다.
 */
function dial(
  url: string,
  init: Bun.WebSocketOptions,
  timeoutMs: number,
): Promise<Result<WsStreams, DialFailure>> {
  return new Promise((resolve) => {
    const made = attempt(() => new WebSocket(url, init));
    if (!made.ok) {
      resolve(err({ kind: "failed", message: messageOf(made.error.cause) }));
      return;
    }
    const ws = made.value;
    // 이진 프레임은 ArrayBuffer로 받는다(기본값 nodebuffer는 streamsOf가 받지 않는다)
    ws.binaryType = "arraybuffer";
    const streams = streamsOf(ws);
    const timer = setTimeout(() => {
      ws.close();
      resolve(err({ kind: "timeout" }));
    }, timeoutMs);
    // 열린 뒤의 닫힘과 오류는 이미 해결된 약속에 영향을 주지 않는다(스트림이 따로 받는다)
    const settle = (result: Result<WsStreams, DialFailure>): void => {
      clearTimeout(timer);
      resolve(result);
    };
    ws.addEventListener("open", () => {
      settle(ok(streams));
    });
    ws.addEventListener("error", (event) => {
      settle(err({ kind: "failed", message: textOf(event) }));
    });
    ws.addEventListener("close", (event) => {
      settle(err({ kind: "failed", message: event.reason }));
    });
  });
}

function dialErrorOf(failure: DialFailure): WsError {
  if (failure.kind === "timeout") return { kind: "timeout" };
  if (failure.message.includes(UPGRADE_REJECTED_TEXT)) return { kind: "upgrade_rejected" };
  return { kind: "io", code: "ws_failed" };
}

function transportOf(
  streams: WsStreams,
  maxFrameBytes: number | undefined,
  logger: Logger | undefined,
): Transport {
  const base = createStdioTransportWith(
    {
      readable: streams.readable,
      writable: streams.writable,
      ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }),
    },
    logger === undefined ? {} : { logger },
  );
  return {
    kind: "socket",
    send: (message) => base.send(message),
    onMessage: (handler) => base.onMessage(handler),
    onClose: (handler) => base.onClose(handler),
    close: (reason) => base.close(reason),
  };
}

interface Target {
  /** 지문을 잴 때 쓴다(괄호가 있어도 된다) */
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
  readonly maxFrameBytes: number | undefined;
  readonly logger: Logger | undefined;
}

async function connectPinned(
  target: Target,
  expected: string,
): Promise<Result<Transport, WsError>> {
  const probed = await probeTlsFingerprint({
    host: target.host,
    port: target.port,
    timeoutMs: target.timeoutMs,
  });
  if (!probed.ok) return err(probed.error);
  const { fingerprint, pem } = probed.value;
  if (fingerprint !== expected) {
    return err({ kind: "fingerprint_changed", expected, actual: fingerprint });
  }
  // 확인한 인증서 하나만 CA로 준다. 다른 인증서는 여기서 검증에 실패해 열리지 않는다
  const dialed = await dial(
    target.url,
    { tls: { ca: [pem] }, headers: target.headers },
    target.timeoutMs,
  );
  if (!dialed.ok) return err(dialErrorOf(dialed.error));
  return ok(transportOf(dialed.value, target.maxFrameBytes, target.logger));
}

async function connectUnpinned(target: Target): Promise<Result<Transport, WsError>> {
  const dialed = await dial(target.url, { headers: target.headers }, target.timeoutMs);
  if (dialed.ok) return ok(transportOf(dialed.value, target.maxFrameBytes, target.logger));
  const failure = dialed.error;
  if (failure.kind === "timeout") return err({ kind: "timeout" });
  // 기본 검증 때문에 실패했는지 가리려고 같은 호스트의 지문을 잰다
  const probed = await probeTlsFingerprint({
    host: target.host,
    port: target.port,
    timeoutMs: target.timeoutMs,
  });
  if (!probed.ok) return err(probed.error);
  if (failure.message.includes(UPGRADE_REJECTED_TEXT)) return err({ kind: "upgrade_rejected" });
  return err({ kind: "tls_untrusted", fingerprint: probed.value.fingerprint });
}

/** 게이트웨이 `/wire`에 붙는 클라이언트 전송. 연결이 열리면 Transport(kind "socket")를 준다 */
export async function connectWebSocket(
  options: WsConnectOptions,
  logger?: Logger,
): Promise<Result<Transport, WsError>> {
  const useTls = options.tls ?? true;
  if (!useTls && !isLoopbackHost(options.host)) {
    return err({ kind: "plaintext_not_loopback", host: options.host });
  }
  const pin = options.pin === undefined ? undefined : normalizePin(options.pin);
  if (options.pin !== undefined && pin === undefined) {
    return err({ kind: "io", code: "invalid_pin" });
  }
  if (pin !== undefined && !useTls) return err({ kind: "io", code: "pin_without_tls" });

  const host = bareHost(options.host);
  const authority = `${host.includes(":") ? `[${host}]` : host}:${String(options.port)}`;
  const path = options.path ?? DEFAULT_PATH;
  const origin = options.origin ?? `${useTls ? "https" : "http"}://${authority}`;
  const headers: Record<string, string> =
    options.token === undefined
      ? { Origin: origin }
      : { Origin: origin, Authorization: `Bearer ${options.token}` };
  const target: Target = {
    host: options.host,
    port: options.port,
    url: `${useTls ? "wss" : "ws"}://${authority}${path.startsWith("/") ? path : `/${path}`}`,
    headers,
    timeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    maxFrameBytes: options.maxFrameBytes,
    logger,
  };

  if (!useTls) {
    const dialed = await dial(target.url, { headers }, target.timeoutMs);
    if (!dialed.ok) return err(dialErrorOf(dialed.error));
    return ok(transportOf(dialed.value, target.maxFrameBytes, target.logger));
  }
  if (pin !== undefined) return connectPinned(target, pin);
  return connectUnpinned(target);
}
