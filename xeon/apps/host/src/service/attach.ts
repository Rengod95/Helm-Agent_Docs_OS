import { err, ok, type Result } from "@fresnel/contracts";
import type { ServiceEndpoint } from "@fresnel/client/endpoint";
import type { ServiceConnectError } from "@fresnel/client/socket";
import type { HostConnection, Transport, WireResult } from "@fresnel/contracts/wire";
import {
  connectServiceTransport,
  createHostConnection,
  helloService,
  type ServiceHelloError,
} from "./connect.ts";
import { defaultServiceCommand } from "./commands.ts";
import { ensureHostService, type ServiceCommand } from "./ensure.ts";

// L4.host-service.spec §3.3.4 `attachToService`, M3-REQ-44. CLI(chat)가 서비스에 붙는 한 번의 절차: 주소를 정하고(원격 주소 또는 이 기기의 서비스를 ensure한 뒤 그 등록
// 소켓), 접속하고, `host.hello`까지 마친 연결을 돌려준다. 엔진을 열지 않는다. 오류는 값이다.

export type AttachTarget =
  /** 원격 주소(SSH 터널, 사설망 TCP, 지정한 Unix 소켓). ensure하지 않는다: 원격 서비스를 띄우는 일은 그 기기의 몫이다 */
  | { readonly kind: "endpoint"; readonly endpoint: ServiceEndpoint }
  /** 이 기기의 서비스. 없으면 띄운다(`start`가 없으면 이 실행 파일의 `service run`) */
  | { readonly kind: "local"; readonly start?: ServiceCommand; readonly runtimeDir?: string };

export type AttachError =
  | { readonly kind: "ensure_failed"; readonly reason: string }
  | { readonly kind: "connect_failed"; readonly error: ServiceConnectError }
  | { readonly kind: "hello_failed"; readonly error: ServiceHelloError };

export interface ServiceAttachment {
  readonly connection: HostConnection;
  readonly hello: WireResult<"host.hello">;
  readonly source: "local" | "remote";
  /**
   * 이 기기의 서비스를 맞출 때 있었던 일. `replaced`: 다른 빌드의 한가한 서비스를 내리고 이 빌드로 새로 띄웠다.
   * `outdated`: 다른 빌드의 서비스가 일하는 중이라 내리지 못하고 그대로 붙었다. 원격 주소나 일이 없으면 없다
   */
  readonly serviceNotice?: "replaced" | "outdated";
}

export interface AttachOptions {
  readonly clientName: string;
  readonly clientKind: "cli" | "desktop" | "other";
  /** 접속한 전송을 감싼다(JSON 모드의 메시지 탭). 호스트는 관여하지 않는다 */
  readonly wrapTransport?: (transport: Transport) => Transport;
}

export async function attachToService(
  target: AttachTarget,
  options: AttachOptions,
): Promise<Result<ServiceAttachment, AttachError>> {
  let endpoint: ServiceEndpoint;
  let serviceNotice: ServiceAttachment["serviceNotice"];
  if (target.kind === "endpoint") {
    endpoint = target.endpoint;
  } else {
    const ensured = await ensureHostService({
      start: target.start ?? defaultServiceCommand(),
      ...(target.runtimeDir === undefined ? {} : { runtimeDir: target.runtimeDir }),
    });
    if (!ensured.ok) return err({ kind: "ensure_failed", reason: ensured.error.kind });
    const outcome = ensured.value.outcome;
    endpoint = { kind: "unix", path: outcome.registration.socket };
    if (outcome.kind === "version_mismatch_busy") serviceNotice = "outdated";
    else if (outcome.replaced) serviceNotice = "replaced";
  }
  const transport = await connectServiceTransport(endpoint);
  if (!transport.ok) return err({ kind: "connect_failed", error: transport.error });
  const connection = createHostConnection(
    options.wrapTransport === undefined ? transport.value : options.wrapTransport(transport.value),
  );
  const hello = await helloService(connection, {
    clientName: options.clientName,
    clientKind: options.clientKind,
  });
  if (!hello.ok) {
    await connection.close();
    return err({ kind: "hello_failed", error: hello.error });
  }
  return ok({
    connection,
    hello: hello.value,
    source: target.kind === "local" ? "local" : "remote",
    ...(serviceNotice === undefined ? {} : { serviceNotice }),
  });
}
