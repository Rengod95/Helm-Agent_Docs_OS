import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { createHostConnection } from "@xeon/client";
import {
  WIRE_PROTOCOL_VERSION,
  WireError,
  type HostConnection,
  type Transport,
  type WireResult,
} from "@xeon/contracts/wire";
import { connectSocket, type SocketError } from "@xeon/platform-process";
import { ENGINE_VERSION } from "../assemble.ts";

// L4.host-service.spec §3.3.4 `connectServiceTransport`. 서비스의 Unix 소켓(또는 TCP)에 접속해 JSON Lines 전송을 돌려준다.
// 소켓 클라이언트는 L0.process의 `connectSocket`을 그대로 쓴다. 원격(SSH 터널·사설망) 접속과 재접속은 M3b B2-RMT다.

export type ServiceEndpoint =
  | { readonly kind: "unix"; readonly path: string }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number };

export function connectServiceTransport(
  endpoint: ServiceEndpoint,
): Promise<Result<Transport, SocketError>> {
  return connectSocket(endpoint);
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
  options: { readonly token?: string; readonly clientName: string },
): Promise<Result<WireResult<"host.hello">, ServiceHelloError>> {
  const sent = await attemptAsync(() =>
    connection.request(
      "host.hello",
      {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: { name: options.clientName, version: ENGINE_VERSION, kind: "other" },
        ...(options.token === undefined ? {} : { auth: { token: options.token } }),
      },
      { timeoutMs: HELLO_TIMEOUT_MS },
    ),
  );
  return sent.ok ? ok(sent.value) : err(helloErrorOf(sent.error.cause));
}

export { createHostConnection };
