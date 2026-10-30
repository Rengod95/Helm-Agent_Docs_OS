import type { ServiceEndpoint } from "@xeon/client/endpoint";
import type { ServiceConnectError } from "@xeon/client/socket";
import {
  checkEnvelope,
  createStdioTransport,
  type CloseInfo,
  type Transport,
} from "@xeon/contracts/wire";
import { messageOf } from "../util.ts";
import { connectServiceTransport } from "./connect.ts";

// L4.host-service.spec §3.3.4 `bridgeStdioToService`, HS-38 보강(M3-REQ-44). 데스크톱 사이드카가 `host --stdio`로 뜬 채 엔진을 열지 않고
// 원격 서비스 소켓에 붙는 경로다. 셸(Rust)은 평소처럼 사이드카의 stdin/stdout만 중계하므로 셸을 바꾸지 않는다. 이 함수는 JSON-RPC를 해석하지 않고
// 줄 하나(메시지 하나)를 envelope 검사만 해서 양쪽으로 옮긴다. TCP 토큰은 전송이 `host.hello`에 싣는다.

export interface BridgeOptions {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly endpoint: ServiceEndpoint;
  /** 진단 한 줄. stderr로 간다 */
  readonly diagnose: (line: string) => void;
}

export type BridgeExit =
  | { readonly code: 0; readonly reason: "stdin_closed" }
  | { readonly code: 1; readonly reason: "remote_closed" | "relay_failed" }
  | { readonly code: 1; readonly reason: "connect_failed"; readonly error: ServiceConnectError };

/** 한 방향 중계: 받은 순서대로 보낸다. 보내기가 실패하면 `fail`을 부른다 */
function relay(
  from: Transport,
  to: Transport,
  label: string,
  options: BridgeOptions,
  fail: () => void,
): void {
  const chain: { tail: Promise<void> } = { tail: Promise.resolve() };
  from.onMessage((raw) => {
    const checked = checkEnvelope(raw);
    if (!checked.ok) {
      options.diagnose(`dropped an invalid ${label} frame`);
      return;
    }
    const { message } = checked;
    chain.tail = chain.tail
      .then(() => to.send(message))
      .catch((cause: unknown) => {
        options.diagnose(`relaying a ${label} frame failed: ${messageOf(cause)}`);
        fail();
      });
  });
}

export async function bridgeStdioToService(options: BridgeOptions): Promise<BridgeExit> {
  const remote = await connectServiceTransport(options.endpoint);
  if (!remote.ok) {
    return { code: 1, reason: "connect_failed", error: remote.error };
  }
  const stdio = createStdioTransport({ readable: options.readable, writable: options.writable });
  const finished = Promise.withResolvers<BridgeExit>();
  const end = (exit: BridgeExit): void => {
    finished.resolve(exit);
  };
  stdio.onClose((_info: CloseInfo) => {
    end({ code: 0, reason: "stdin_closed" });
  });
  remote.value.onClose(() => {
    end({ code: 1, reason: "remote_closed" });
  });
  const failRelay = (): void => {
    end({ code: 1, reason: "relay_failed" });
  };
  relay(stdio, remote.value, "client", options, failRelay);
  relay(remote.value, stdio, "service", options, failRelay);
  const exit = await finished.promise;
  await Promise.allSettled([stdio.close("bridge_end"), remote.value.close("bridge_end")]);
  return exit;
}
