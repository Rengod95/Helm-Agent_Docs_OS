// 게이트웨이(spec §5): 루프백 HTTP 리스너와 외부 HTTPS 리스너를 같은 요청 처리기 위에 연다.
// 구성 요소는 모두 주입한다(인증, 세션 공장, 푸시, shim, 폴더, 서비스 소켓 연결, 시계, 로거). 서비스나 셸 구현을 여기서 만들지 않는다.
import { constants } from "node:crypto";
import {
  attempt,
  attemptAsync,
  err,
  ok,
  type Clock,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import type { AuthPort } from "../auth/auth-port.ts";
import type { TabSessionFactory } from "../session/ports.ts";
import type { TlsMaterial } from "../tls/store.ts";
import {
  BACKPRESSURE_BYTES,
  MAX_SHELL_MESSAGE_CHARS,
  type CloseReason,
  type SocketData,
} from "./link.ts";
import { openShellLink, type ShellDeps } from "./shell-link.ts";
import type { PushService, ServiceConnection, ShimSource } from "./ports.ts";
import { handleRequest, type ListenerConfig, type RouteDeps } from "./routes.ts";
import { openWireLink, type WireDeps } from "./wire-link.ts";
import { buildLoginSource } from "./login-bundle.ts";

/**
 * TLS 1.0~1.2를 끈다(spec §8.2: 외부 리스너는 TLS 1.3만). Bun 1.4.3 실측(scratchpad `spike/tls13.ts`, `openssl-check.ts`):
 * `secureOptions`의 `SSL_OP_NO_TLSv1|1_1|1_2`로 1.2 전용 클라이언트는 protocol_version 경고(70)로 거절되고 1.3은 붙는다.
 * Bun의 `TLSOptions` 타입에는 `minVersion`이 없고, 문자열 `"TLSv1.3"`은 `must be a number`로 거절된다. 그래서 이 비트를 쓴다.
 */
const TLS13_ONLY: number =
  constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 | constants.SSL_OP_NO_TLSv1_2;

/**
 * 기기 폐기 때 닫는 WebSocket 코드. spec §8.3 5는 "wire 코드 1004 `auth`"라고 적었다. 1004는 WebSocket이 예약해 둔 코드라
 * 브라우저와 런타임이 받지 않을 수 있으므로 사용자 정의 범위의 4401을 쓴다(Bun 실측: 클라이언트가 4401과 "auth"를 받는다). 스펙 정정 대상이다.
 */
const CLOSE_FOR_REASON: Readonly<
  Record<CloseReason, { readonly code: number; readonly reason: string }>
> = {
  revoked: { code: 4401, reason: "auth" },
};

export interface TlsListenerOptions {
  readonly host: string;
  readonly port: number;
  /** 받을 `Host` 이름(검사 목록). 루프백 이름은 자동으로 받는다 */
  readonly hosts: readonly string[];
  readonly material: TlsMaterial;
}

export interface GatewayOptions {
  readonly auth: AuthPort;
  readonly sessions: TabSessionFactory;
  /** 푸시를 쓰지 않으면 `null`(`/push/*`는 404) */
  readonly push: PushService | null;
  readonly shim: ShimSource;
  /** UI 번들 폴더(`index.html`과 `assets/`) */
  readonly uiDir: string;
  /** 로그인 화면 HTML과 CSS가 있는 폴더(`login.html`, `login.css`). 스크립트와 `sw.js`는 여기서 읽지 않는다 */
  readonly staticDir: string;
  /** `/sw.js`의 글자. 호출자가 준다(게이트웨이는 파일을 직접 읽지 않는다) */
  readonly serviceWorkerSource: () => Promise<string>;
  /** `/login.js`의 글자. 생략하면 `static/login.ts`를 시작 때 묶는다(`login-bundle.ts`). 실패는 `Result` 오류다 */
  readonly loginSource?: () => Promise<Result<string, unknown>>;
  readonly serviceSocketPath: string;
  readonly connectService: (path: string) => ServiceConnection;
  /** 루프백 HTTP 리스너(`127.0.0.1`). `port` 0이면 빈 포트를 쓴다 */
  readonly loopback: { readonly port: number } | null;
  /** 외부 HTTPS 리스너. `null`이면 열지 않는다 */
  readonly tls: TlsListenerOptions | null;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface GatewayInfo {
  /** 실제로 연 포트(0을 주었으면 빈 포트) */
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  /** TLS 인증서 지문(소문자 16진 SHA-256). TLS를 열지 않았으면 `null` */
  readonly fingerprint: string | null;
}

export type GatewayError =
  | { readonly kind: "already_started" }
  | { readonly kind: "no_listener" }
  /** 시작 때 읽어야 하는 글자(shim, 로그인 스크립트, 서비스 워커) 가운데 하나를 얻지 못했다. 그 전에는 아무것도 열지 않는다 */
  | {
      readonly kind: "source_unavailable";
      readonly source: "shim" | "login" | "service_worker";
      readonly cause: unknown;
    }
  | {
      readonly kind: "listen_failed";
      readonly listener: "loopback" | "tls";
      readonly code: string;
    };

export interface Gateway {
  start(): Promise<Result<GatewayInfo, GatewayError>>;
  stop(): Promise<void>;
  /** 기기의 열린 WebSocket 연결을 모두 닫는다(폐기). 연결이 없으면 아무 일도 없다 */
  closeDevice(deviceId: string, reason: CloseReason): void;
}

interface Endpoint {
  readonly name: "loopback" | "tls";
  readonly hostname: string;
  readonly port: number;
  readonly listener: ListenerConfig;
  readonly tls: {
    readonly key: string;
    readonly cert: string;
    readonly secureOptions: number;
  } | null;
}

type Phase = "idle" | "running" | "stopped";

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function createGateway(options: GatewayOptions): Gateway {
  const sockets = new Map<string, Set<Bun.ServerWebSocket<SocketData>>>();
  const servers: Bun.Server<SocketData>[] = [];
  let phase: Phase = "idle";
  let unsubscribe: (() => void) | null = null;

  const wireDeps: WireDeps = {
    serviceSocketPath: options.serviceSocketPath,
    connectService: options.connectService,
    logger: options.logger,
  };
  const shellDeps: ShellDeps = { sessions: options.sessions, logger: options.logger };

  function track(ws: Bun.ServerWebSocket<SocketData>): void {
    const id = ws.data.device.id;
    const set = sockets.get(id) ?? new Set<Bun.ServerWebSocket<SocketData>>();
    set.add(ws);
    sockets.set(id, set);
  }

  function untrack(ws: Bun.ServerWebSocket<SocketData>): void {
    const id = ws.data.device.id;
    const set = sockets.get(id);
    if (set === undefined) return;
    set.delete(ws);
    if (set.size === 0) sockets.delete(id);
  }

  const websocket: Bun.WebSocketHandler<SocketData> = {
    // 프레임 상한은 연결 종류마다 `link`가 본다(`/wire` 1 MiB 프레임, `/shell` 8 MiB 글자). 여기는 둘 중 큰 값이다
    maxPayloadLength: MAX_SHELL_MESSAGE_CHARS,
    // 송신 버퍼가 이 값을 넘으면 `send`가 -1을 주고, `drain`이 올 때까지 서비스 읽기를 멈춘다
    backpressureLimit: BACKPRESSURE_BYTES,
    closeOnBackpressureLimit: false,
    open(ws) {
      track(ws);
      ws.data.link =
        ws.data.kind === "wire" ? openWireLink(ws, wireDeps) : openShellLink(ws, shellDeps);
    },
    message(ws, message) {
      ws.data.link?.onMessage(message);
    },
    drain(ws) {
      ws.data.link?.onDrain();
    },
    close(ws) {
      untrack(ws);
      const link = ws.data.link;
      ws.data.link = null;
      link?.onClose();
    },
  };

  function serveEndpoint(
    endpoint: Endpoint,
    deps: RouteDeps,
  ): Result<Bun.Server<SocketData>, GatewayError> {
    const started = attempt(() =>
      Bun.serve<SocketData>({
        hostname: endpoint.hostname,
        port: endpoint.port,
        ...(endpoint.tls === null ? {} : { tls: endpoint.tls }),
        fetch: (req, server) => handleRequest(req, server, endpoint.listener, deps),
        websocket,
      }),
    );
    if (!started.ok) {
      return err({
        kind: "listen_failed",
        listener: endpoint.name,
        code: codeOf(started.error.cause),
      });
    }
    return ok(started.value);
  }

  async function stopServers(): Promise<void> {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
  }

  function closeDevice(deviceId: string, reason: CloseReason): void {
    const set = sockets.get(deviceId);
    if (set === undefined) return;
    const count = set.size;
    const close = CLOSE_FOR_REASON[reason];
    // 닫는 동안 `close` 처리기가 집합에서 빼도 순회는 안전하다(Set은 지운 항목을 건너뛴다)
    for (const ws of set) ws.close(close.code, close.reason);
    options.logger.info("gateway.device_connections_closed", { deviceId, reason, count });
  }

  async function start(): Promise<Result<GatewayInfo, GatewayError>> {
    if (phase !== "idle") return err({ kind: "already_started" });
    if (options.loopback === null && options.tls === null) return err({ kind: "no_listener" });
    // 스크립트 글자는 시작 때 한 번 만들어 메모리에 둔다(ports.ts). 하나라도 못 얻으면 아무것도 열지 않는다
    const shim = await attemptAsync(() => options.shim());
    if (!shim.ok) {
      return err({ kind: "source_unavailable", source: "shim", cause: shim.error.cause });
    }
    const login = await (options.loginSource ?? buildLoginSource)();
    if (!login.ok) {
      return err({ kind: "source_unavailable", source: "login", cause: login.error });
    }
    const serviceWorker = await attemptAsync(() => options.serviceWorkerSource());
    if (!serviceWorker.ok) {
      return err({
        kind: "source_unavailable",
        source: "service_worker",
        cause: serviceWorker.error.cause,
      });
    }
    const deps: RouteDeps = {
      auth: options.auth,
      push: options.push,
      uiDir: options.uiDir,
      staticDir: options.staticDir,
      shimBody: shim.value,
      loginBody: login.value,
      serviceWorkerBody: serviceWorker.value,
      clock: options.clock,
      logger: options.logger,
    };

    const loopback: Endpoint | null =
      options.loopback === null
        ? null
        : {
            name: "loopback",
            hostname: "127.0.0.1",
            port: options.loopback.port,
            listener: { kind: "loopback", allowedHosts: [] },
            tls: null,
          };
    const tls: TlsListenerOptions | null = options.tls;
    const external: Endpoint | null =
      tls === null
        ? null
        : {
            name: "tls",
            hostname: tls.host,
            port: tls.port,
            listener: { kind: "tls", allowedHosts: tls.hosts },
            tls: {
              key: tls.material.keyPem,
              cert: tls.material.certPem,
              secureOptions: TLS13_ONLY,
            },
          };

    let loopbackPort: number | null = null;
    let tlsPort: number | null = null;
    let failure: GatewayError | null = null;
    for (const endpoint of [loopback, external]) {
      if (endpoint === null) continue;
      const served = serveEndpoint(endpoint, deps);
      if (!served.ok) {
        failure = served.error;
        break;
      }
      servers.push(served.value);
      const port = served.value.port ?? 0;
      if (endpoint.name === "loopback") loopbackPort = port;
      else tlsPort = port;
    }
    if (failure !== null) {
      // 한쪽이라도 못 열면 먼저 연 쪽을 닫고 시작을 실패로 돌려준다
      await stopServers();
      return err(failure);
    }

    phase = "running";
    unsubscribe = options.auth.onRevoked((revoked) => {
      for (const device of revoked) closeDevice(device.id, "revoked");
    });
    options.logger.info("gateway.listening", { loopbackPort, tlsPort });
    return ok({
      loopbackPort,
      tlsPort,
      fingerprint: tls === null ? null : tls.material.fingerprint,
    });
  }

  async function stop(): Promise<void> {
    if (phase !== "running") return;
    phase = "stopped";
    unsubscribe?.();
    unsubscribe = null;
    for (const set of sockets.values()) {
      for (const ws of set) ws.close(1001, "gateway_stopped");
    }
    await stopServers();
    options.logger.info("gateway.stopped");
  }

  return { start, stop, closeDevice };
}
