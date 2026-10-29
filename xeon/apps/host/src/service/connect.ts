import { assertNever, attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { createHostConnection } from "@xeon/client";
import type { ServiceEndpoint } from "@xeon/client/endpoint";
import {
  connectServiceTransport as connectEndpoint,
  type ConnectServiceOptions,
  type ServiceConnectError,
} from "@xeon/client/socket";
import {
  WIRE_PROTOCOL_VERSION,
  WireError,
  type HostConnection,
  type Transport,
  type WireResult,
} from "@xeon/contracts/wire";
import type { SocketError } from "@xeon/platform-process";
import { ENGINE_VERSION } from "../assemble.ts";
import { createSshTunnelPort } from "./tunnel.ts";

// L4.host-service.spec §3.3.4 `connectServiceTransport`. 서비스의 Unix 소켓, 사설망 TCP, SSH 터널로 이은 소켓에 접속해 JSON Lines 전송을 돌려준다.
// 소켓 클라이언트는 `@xeon/client/socket`에 있고(adr.0020), 이 함수는 거기에 L0 `openTunnel`로 채운 터널 포트를 끼워 준다.

export type { ServiceEndpoint };

export function connectServiceTransport(
  endpoint: ServiceEndpoint,
  options: ConnectServiceOptions = {},
): Promise<Result<Transport, ServiceConnectError>> {
  return connectEndpoint(endpoint, { tunnel: createSshTunnelPort(), ...options });
}

export type ServiceHelloError =
  | { readonly kind: "auth_failed"; readonly reason: "missing" | "invalid" | "unknown" }
  | { readonly kind: "protocol_unsupported" }
  | { readonly kind: "timeout" }
  | { readonly kind: "closed" };

const HELLO_TIMEOUT_MS = 3000;

function authReasonOf(details: unknown): "missing" | "invalid" | "unknown" {
  if (typeof details !== "object" || details === null || !("reason" in details)) return "unknown";
  const reason: unknown = details.reason;
  return reason === "missing" || reason === "invalid" ? reason : "unknown";
}

function helloErrorOf(caught: unknown): ServiceHelloError {
  if (caught instanceof WireError) {
    if (caught.data.kind === "host.authFailed") {
      return { kind: "auth_failed", reason: authReasonOf(caught.data.details) };
    }
    if (caught.data.kind === "protocol.unsupported") return { kind: "protocol_unsupported" };
    return { kind: "closed" };
  }
  const kind =
    typeof caught === "object" && caught !== null && "kind" in caught ? caught.kind : undefined;
  return kind === "timeout" ? { kind: "timeout" } : { kind: "closed" };
}

/** 접속한 연결에서 `host.hello`를 한 번 보낸다. 토큰은 TCP 접속에서만 싣는다 */
export async function helloService(
  connection: HostConnection,
  options: {
    readonly token?: string;
    readonly clientName: string;
    /** 기본 "other" */
    readonly clientKind?: "cli" | "desktop" | "other";
  },
): Promise<Result<WireResult<"host.hello">, ServiceHelloError>> {
  const sent = await attemptAsync(() =>
    connection.request(
      "host.hello",
      {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: {
          name: options.clientName,
          version: ENGINE_VERSION,
          kind: options.clientKind ?? "other",
        },
        ...(options.token === undefined ? {} : { auth: { token: options.token } }),
      },
      { timeoutMs: HELLO_TIMEOUT_MS },
    ),
  );
  return sent.ok ? ok(sent.value) : err(helloErrorOf(sent.error.cause));
}

/** 로컬 Unix 소켓 접속 오류를 L0 `ensureService`가 아는 `SocketError`로 바꾼다. 로컬 unix 접속에는 토큰·터널 오류가 없어 `io`로 둔다 */
export function socketErrorOf(error: ServiceConnectError): SocketError {
  switch (error.kind) {
    case "not_found":
    case "refused":
    case "permission":
      return { kind: error.kind, path: error.path };
    case "io":
      return { kind: "io", code: error.code };
    case "tunnel_unavailable":
    case "tunnel_failed":
      return { kind: "io", code: error.kind };
    default:
      return assertNever(error, "ServiceConnectError");
  }
}

export { createHostConnection };
