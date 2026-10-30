import { chmodSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { err, ok, attempt, type Logger, type Result } from "@xeon/contracts";
import { createStdioTransportWith, type Transport } from "@xeon/contracts/wire";

// L0.process.spec §3.2 transport/socket.ts, §4.1 socket, §4.4.5. 소켓 위의 JSON Lines 전송. 프레임과 한도 검사는 stdio 전송과 같은 구현이다.
// - unix: 소켓 파일을 0600으로 만든다. 디렉터리 0700과 소유자 검사는 L0.os가 정한 runtimeDir이 맡는다. 토큰을 요구하지 않는다.
// - tcp: 토큰이 필요한 전송이다. 토큰 없이는 열지 않는다(`token_required`). 토큰 검사는 `host.hello`의 `auth.token`에서 위층이 한다
//   (PeerInfo.requiresToken이 참인 연결만). 비루프백 주소는 `allowNonLoopback`을 명시할 때만 열 수 있다(`tcp_not_loopback`).

export type SocketError =
  | { readonly kind: "address_in_use"; readonly path: string }
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "refused"; readonly path: string }
  | { readonly kind: "path_too_long"; readonly path: string; readonly limit: number }
  | { readonly kind: "permission"; readonly path: string }
  | { readonly kind: "token_required" }
  /** tcp 주소가 루프백이 아닌데 `allowNonLoopback`이 없다 */
  | { readonly kind: "tcp_not_loopback"; readonly host: string }
  | { readonly kind: "io"; readonly code: string };

export type SocketListenOptions =
  | { readonly kind: "unix"; readonly path: string; readonly maxFrameBytes?: number }
  | {
      readonly kind: "tcp";
      readonly host: string;
      /** 0이면 운영체제가 고른다. 고른 값은 `SocketListener.path`의 `host:port`에 담긴다 */
      readonly port: number;
      /** 비어 있으면 열지 않는다 */
      readonly token: string;
      /** 루프백이 아닌 주소를 열려면 참이어야 한다 [결정: 오케스트레이터 기본값] */
      readonly allowNonLoopback?: boolean;
      readonly maxFrameBytes?: number;
    };

export type SocketConnectOptions =
  | { readonly kind: "unix"; readonly path: string; readonly maxFrameBytes?: number }
  | {
      readonly kind: "tcp";
      readonly host: string;
      readonly port: number;
      readonly maxFrameBytes?: number;
    };

export interface PeerInfo {
  readonly connectionId: string;
  /** 참이면 `host.hello`에 올바른 `auth.token`이 있어야 한다(TCP) */
  readonly requiresToken: boolean;
}

/** 서버 쪽 리스너. 연결마다 Transport 하나 */
export interface SocketListener {
  /** unix는 소켓 경로, tcp는 `host:port` */
  readonly path: string;
  readonly kind: "unix" | "tcp";
  onConnection(handler: (transport: Transport, peer: PeerInfo) => void): () => void;
  readonly connectionCount: number;
  close(): Promise<void>;
}

/** 루프백 주소인가: `localhost`, `127.x.x.x`, `::1` */
export function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" || host === "::1" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** sun_path 한도(macOS 104, Linux 108). 작은 쪽을 쓴다(L0.os.spec §3.2) */
export const UNIX_SOCKET_PATH_LIMIT = 103;

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function socketErrorOf(caught: unknown, path: string): SocketError {
  const code = codeOf(caught);
  if (code === "EADDRINUSE") return { kind: "address_in_use", path };
  if (code === "ENOENT") return { kind: "not_found", path };
  if (code === "ECONNREFUSED") return { kind: "refused", path };
  if (code === "EACCES" || code === "EPERM") return { kind: "permission", path };
  return { kind: "io", code };
}

/** node 소켓을 전송이 읽고 쓰는 웹 스트림 쌍으로 바꾼다 */
function streamsOf(socket: Socket): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  // 전송이 읽기를 취소(close)한 뒤에도 소켓 이벤트가 올 수 있다. 닫힌 컨트롤러에는 더 쓰지 않는다
  const state = { done: false };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on("data", (chunk: Buffer) => {
        if (!state.done) controller.enqueue(new Uint8Array(chunk));
      });
      socket.on("end", () => {
        if (state.done) return;
        state.done = true;
        controller.close();
      });
      socket.on("error", (caught) => {
        if (state.done) return;
        state.done = true;
        controller.error(caught);
      });
    },
    cancel() {
      state.done = true;
      socket.destroy();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        socket.write(chunk, (caught) => {
          if (caught === null || caught === undefined) resolve();
          else reject(caught);
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        // 읽기 취소로 이미 destroy된 소켓은 finish가 오지 않는다
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.once("close", () => {
          resolve();
        });
        socket.end();
      });
    },
  });
  return { readable, writable };
}

/** stdio 전송과 같은 프레이밍을 쓰되 종류만 "socket"이다 */
function transportOf(
  socket: Socket,
  maxFrameBytes: number | undefined,
  logger?: Logger,
): Transport {
  const { readable, writable } = streamsOf(socket);
  const base = createStdioTransportWith(
    { readable, writable, ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }) },
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

function listenOn(
  server: Server,
  options: SocketListenOptions,
): Promise<Result<void, SocketError>> {
  const label = options.kind === "unix" ? options.path : `${options.host}:${String(options.port)}`;
  return new Promise((resolve) => {
    const onError = (caught: unknown): void => {
      resolve(err(socketErrorOf(caught, label)));
    };
    server.once("error", onError);
    const done = (): void => {
      server.off("error", onError);
      resolve(ok(undefined));
    };
    if (options.kind === "unix") {
      // bind는 listen 호출 안에서 동기로 일어난다. 그 순간만 umask를 0177로 좁혀 소켓 파일이 만들어지는 때부터 0600이 되게 한다
      // (만든 뒤 chmod까지의 틈에 다른 사용자가 접속하는 길을 없앤다). 바로 원래 값으로 되돌려 다른 파일 생성에 영향을 주지 않는다
      const previous = process.umask(0o177);
      try {
        server.listen(options.path, done);
      } finally {
        process.umask(previous);
      }
    } else server.listen(options.port, options.host, done);
  });
}

export async function listenSocket(
  options: SocketListenOptions,
  logger?: Logger,
): Promise<Result<SocketListener, SocketError>> {
  if (options.kind === "tcp" && options.token.length === 0) return err({ kind: "token_required" });
  if (
    options.kind === "tcp" &&
    options.allowNonLoopback !== true &&
    !isLoopbackHost(options.host)
  ) {
    return err({ kind: "tcp_not_loopback", host: options.host });
  }
  if (options.kind === "unix" && Buffer.byteLength(options.path) > UNIX_SOCKET_PATH_LIMIT) {
    return err({ kind: "path_too_long", path: options.path, limit: UNIX_SOCKET_PATH_LIMIT });
  }
  const server = createServer();
  const handlers = new Set<(transport: Transport, peer: PeerInfo) => void>();
  const sockets = new Set<Socket>();
  const waiting: { readonly transport: Transport; readonly peer: PeerInfo }[] = [];
  const counter = { next: 0 };
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    counter.next += 1;
    const peer: PeerInfo = {
      connectionId: `sock-${String(counter.next)}`,
      requiresToken: options.kind === "tcp",
    };
    const transport = transportOf(socket, options.maxFrameBytes, logger);
    // 처리기가 아직 없으면(서비스가 엔진을 여는 동안) 연결을 대기열에 두고 첫 처리기가 붙을 때 넘긴다(L0.process.spec §4.4.3 4번).
    // 전송은 구독이 붙기 전에 온 바이트를 쌓아 두므로 먼저 보낸 `host.hello`를 잃지 않는다
    if (handlers.size === 0) {
      waiting.push({ transport, peer });
      return;
    }
    for (const handler of Array.from(handlers)) handler(transport, peer);
  });
  const listened = await listenOn(server, options);
  if (!listened.ok) return listened;
  let path: string;
  if (options.kind === "unix") {
    path = options.path;
    // 디렉터리가 0700이라 만든 직후의 짧은 틈에도 같은 사용자만 닿는다. 파일 자체도 0600으로 좁힌다
    const narrowed = attempt(() => {
      chmodSync(options.path, 0o600);
    });
    if (!narrowed.ok) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return err({ kind: "permission", path: options.path });
    }
  } else {
    const address = server.address();
    path =
      address !== null && typeof address === "object"
        ? `${options.host}:${String(address.port)}`
        : `${options.host}:${String(options.port)}`;
  }
  return ok({
    path,
    kind: options.kind,
    onConnection(handler) {
      handlers.add(handler);
      for (const entry of waiting.splice(0)) handler(entry.transport, entry.peer);
      return () => {
        handlers.delete(handler);
      };
    },
    get connectionCount() {
      return sockets.size;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      // node는 unix 소켓 파일을 닫을 때 지운다. 남아 있으면 낡은 파일이라 다음 기동이 활성화 잠금 아래에서 처리한다.
      // 여기서 다시 지우면 그 사이에 같은 경로를 바인드한 다른 서비스의 소켓을 지울 수 있다
    },
  });
}

/** 클라이언트 쪽 socket 전송 */
export function connectSocket(
  options: SocketConnectOptions,
  logger?: Logger,
): Promise<Result<Transport, SocketError>> {
  const label = options.kind === "unix" ? options.path : `${options.host}:${String(options.port)}`;
  return new Promise((resolve) => {
    const socket =
      options.kind === "unix"
        ? connect({ path: options.path })
        : connect({ host: options.host, port: options.port });
    const onError = (caught: unknown): void => {
      socket.destroy();
      resolve(err(socketErrorOf(caught, label)));
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(ok(transportOf(socket, options.maxFrameBytes, logger)));
    });
  });
}
