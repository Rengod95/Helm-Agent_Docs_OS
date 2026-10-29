import { connect, type Socket } from "node:net";
import { assertNever, detach, err, ok, type Result } from "@xeon/contracts";
import {
  createStdioTransportWith,
  type JsonRpcMessage,
  type Transport,
  type Unsubscribe,
  type CloseInfo,
} from "@xeon/contracts/wire";
import type { ServiceEndpoint } from "./endpoint.ts";

// ADR-0020 §3.3, L4.host-service.spec §3.3.4 `connectServiceTransport`. 서비스 소켓(Unix, 사설망 TCP, SSH 터널로 이은 Unix)에 접속하는
// 클라이언트 쪽 전송이다. Node의 `node:net`을 쓰므로 브라우저 번들에 들어가면 안 된다: 이 파일은 `@xeon/client/socket`으로만 가져온다
// (`.`과 `./stdio`는 Node API가 없다). 줄 프레이밍은 F `createStdioTransportWith`를 그대로 쓴다.
// 프로세스를 띄우는 일(ssh)은 L0 `platform-process`만 할 수 있어(DR-07) 이 패키지는 `TunnelPort`만 정의하고 조립 쪽(apps/host)이 채운다.

/** 터널을 열려는 요청. 로컬 소켓 경로는 포트 구현이 정한다 */
export interface TunnelRequest {
  readonly target: string;
  readonly remoteSocket: string;
  readonly port?: number;
}

export interface TunnelHandle {
  /** 포트가 만든 로컬 Unix 소켓. 이 경로로 접속한다 */
  readonly localSocket: string;
  /** 정리한다: 터널 프로세스를 멈추고 임시 파일을 지운다. 여러 번 불러도 된다 */
  close(): Promise<void>;
}

export type TunnelFailureKind =
  | "invalid_request"
  | "spawn_failed"
  | "exited"
  | "timeout"
  | "path_too_long";

export interface TunnelFailure {
  readonly kind: TunnelFailureKind;
  /** 사람이 읽을 한 줄(ssh의 stderr 끝부분 등) */
  readonly detail: string;
}

export interface TunnelPort {
  open(request: TunnelRequest): Promise<Result<TunnelHandle, TunnelFailure>>;
}

export type ServiceConnectError =
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "refused"; readonly path: string }
  | { readonly kind: "permission"; readonly path: string }
  | { readonly kind: "io"; readonly code: string }
  /** tcp 접속에는 토큰이 필요하다 */
  | { readonly kind: "token_required" }
  /** ssh 주소인데 터널 포트가 주어지지 않았다 */
  | { readonly kind: "tunnel_unavailable" }
  | { readonly kind: "tunnel_failed"; readonly failure: TunnelFailure };

export interface ConnectServiceOptions {
  /** ssh 주소에 필요하다 */
  readonly tunnel?: TunnelPort;
  readonly maxFrameBytes?: number;
  /** 전송이 닫힌 뒤 터널 정리가 실패했을 때 알린다. 접속 결과에는 영향이 없다. 없으면 버린다 */
  readonly onTunnelError?: (cause: unknown) => void;
}

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function connectErrorOf(caught: unknown, label: string): ServiceConnectError {
  const code = codeOf(caught);
  if (code === "ENOENT") return { kind: "not_found", path: label };
  if (code === "ECONNREFUSED") return { kind: "refused", path: label };
  if (code === "EACCES" || code === "EPERM") return { kind: "permission", path: label };
  return { kind: "io", code };
}

/** node 소켓을 전송이 읽고 쓰는 웹 스트림 쌍으로 바꾼다 */
function streamsOf(socket: Socket): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  // 전송이 읽기를 취소한 뒤에도 소켓 이벤트가 올 수 있다. 닫힌 컨트롤러에는 더 쓰지 않는다
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

function connectNet(
  options: { readonly path: string } | { readonly host: string; readonly port: number },
  maxFrameBytes: number | undefined,
): Promise<Result<Transport, ServiceConnectError>> {
  const label = "path" in options ? options.path : `${options.host}:${String(options.port)}`;
  return new Promise((resolve) => {
    const socket = connect(options);
    const onError = (caught: unknown): void => {
      socket.destroy();
      resolve(err(connectErrorOf(caught, label)));
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      const { readable, writable } = streamsOf(socket);
      const base = createStdioTransportWith({
        readable,
        writable,
        ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }),
      });
      resolve(
        ok({
          kind: "socket",
          send: (message) => base.send(message),
          onMessage: (handler) => base.onMessage(handler),
          onClose: (handler) => base.onClose(handler),
          close: (reason) => base.close(reason),
        }),
      );
    });
  });
}

/** `host.hello`에 `auth.token`을 싣는다. 이미 `auth`가 있는 요청은 그대로 둔다 */
function injectHelloAuth(inner: Transport, token: string): Transport {
  return {
    kind: inner.kind,
    send(message: JsonRpcMessage) {
      if ("method" in message && message.method === "host.hello" && !("auth" in message.params)) {
        return inner.send({ ...message, params: { ...message.params, auth: { token } } });
      }
      return inner.send(message);
    },
    onMessage: (handler) => inner.onMessage(handler),
    onClose: (handler) => inner.onClose(handler),
    close: (reason) => inner.close(reason),
  };
}

/** `TunnelPort.close()`는 거부하지 않는 계약이다. 어긋난 구현의 오류를 알릴 곳이 없을 때만 버린다 */
function ignoreTunnelError(): void {
  // 호출자가 onTunnelError를 주지 않았다
}

/** 전송이 닫히면(우리가 닫든 상대가 끊든) 터널도 정리한다 */
function withTunnel(
  inner: Transport,
  tunnel: TunnelHandle,
  onError: (cause: unknown) => void,
): Transport {
  const release = (): void => {
    detach(tunnel.close(), onError);
  };
  inner.onClose(release);
  return {
    kind: inner.kind,
    send: (message) => inner.send(message),
    onMessage: (handler: (message: unknown) => void): Unsubscribe => inner.onMessage(handler),
    onClose: (handler: (info: CloseInfo) => void): Unsubscribe => inner.onClose(handler),
    async close(reason) {
      try {
        await inner.close(reason);
      } finally {
        await tunnel.close();
      }
    },
  };
}

/**
 * 서비스에 접속해 JSON Lines 전송을 돌려준다. `host.hello`는 호출자가 보낸다(토큰이 있는 tcp 주소면 이 전송이 `auth.token`을 싣는다).
 * ssh 주소는 `options.tunnel`로 터널을 먼저 열고 그 로컬 소켓에 접속한다.
 */
export async function connectServiceTransport(
  endpoint: ServiceEndpoint,
  options: ConnectServiceOptions = {},
): Promise<Result<Transport, ServiceConnectError>> {
  switch (endpoint.kind) {
    case "unix":
      return connectNet({ path: endpoint.path }, options.maxFrameBytes);
    case "tcp": {
      if (endpoint.token === undefined || endpoint.token === "") {
        return err({ kind: "token_required" });
      }
      const connected = await connectNet(
        { host: endpoint.host, port: endpoint.port },
        options.maxFrameBytes,
      );
      return connected.ok ? ok(injectHelloAuth(connected.value, endpoint.token)) : connected;
    }
    case "ssh": {
      if (options.tunnel === undefined) return err({ kind: "tunnel_unavailable" });
      const opened = await options.tunnel.open({
        target: endpoint.target,
        remoteSocket: endpoint.remoteSocket,
        ...(endpoint.port === undefined ? {} : { port: endpoint.port }),
      });
      if (!opened.ok) return err({ kind: "tunnel_failed", failure: opened.error });
      const connected = await connectNet({ path: opened.value.localSocket }, options.maxFrameBytes);
      if (!connected.ok) {
        await opened.value.close();
        return connected;
      }
      return ok(
        withTunnel(connected.value, opened.value, options.onTunnelError ?? ignoreTunnelError),
      );
    }
    default:
      return assertNever(endpoint, "ServiceEndpoint");
  }
}
