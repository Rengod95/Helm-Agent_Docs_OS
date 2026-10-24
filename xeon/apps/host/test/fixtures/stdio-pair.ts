import type { Transport } from "@xeon/contracts/wire";
import { createStdioTransport } from "../../src/transport/stdio.ts";

// 같은 프로세스 안의 스트림 쌍 두 개로 stdio 전송의 서버 쪽과 클라이언트 쪽을 이어 준다(L4.host-service.plan H6).

export interface StdioStreams {
  /** 서버가 읽고 클라이언트가 쓴다 */
  readonly clientToServer: TransformStream<Uint8Array, Uint8Array>;
  /** 클라이언트가 읽고 서버가 쓴다 */
  readonly serverToClient: TransformStream<Uint8Array, Uint8Array>;
}

export function stdioStreams(): StdioStreams {
  return {
    clientToServer: new TransformStream<Uint8Array, Uint8Array>(),
    serverToClient: new TransformStream<Uint8Array, Uint8Array>(),
  };
}

export function stdioPair(maxFrameBytes?: number): {
  readonly server: Transport;
  readonly client: Transport;
} {
  const streams = stdioStreams();
  const frame = maxFrameBytes === undefined ? {} : { maxFrameBytes };
  return {
    server: createStdioTransport({
      readable: streams.clientToServer.readable,
      writable: streams.serverToClient.writable,
      ...frame,
    }),
    client: createStdioTransport({
      readable: streams.serverToClient.readable,
      writable: streams.clientToServer.writable,
      ...frame,
    }),
  };
}
